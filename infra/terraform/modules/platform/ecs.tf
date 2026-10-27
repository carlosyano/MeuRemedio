# ECS Fargate (DC-070, DC-071): API, worker e web como servicos; a migracao como definicao de
# tarefa avulsa, executada pelo CD antes de atualizar os servicos. Segredos so pelo campo secrets.
locals {
  rds_ca_path = "/app/apps/api/assets/rds-ca-${var.region}.pem"

  # TLS verificado contra a CA do RDS embarcada na imagem; usuario e senha vem de PGUSER e
  # PGPASSWORD (o driver pg os le do ambiente quando a URL nao os traz).
  database_url = "postgres://${aws_db_instance.main.address}:5432/meuremedio?sslmode=verify-full&sslrootcert=${local.rds_ca_path}"

  database_secrets = [
    { name = "PGUSER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
    { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
  ]

  storage_env = [
    { name = "EXPORT_STORAGE_BUCKET", value = aws_s3_bucket.exports.bucket },
    { name = "EXPORT_STORAGE_KMS_KEY_ID", value = aws_kms_key.main.arn },
  ]

  common_env = [
    { name = "NODE_ENV", value = "production" },
    { name = "AWS_REGION", value = var.region },
    { name = "DATABASE_URL", value = local.database_url },
  ]

  # Chave atual e anteriores da rotacao (DC-065): NOME e NOME_PREVIOUS.
  api_secrets = concat(local.database_secrets, flatten([
    for name in local.app_secrets : [
      { name = name, valueFrom = "${aws_secretsmanager_secret.app[name].arn}:current::" },
      { name = "${name}_PREVIOUS", valueFrom = "${aws_secretsmanager_secret.app[name].arn}:previous::" },
    ]
  ]))

  log_options = {
    for name, group in aws_cloudwatch_log_group.app : name => {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = group.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = name
      }
    }
  }

  api_command = {
    api     = ["node", "apps/api/dist/main.js"]
    worker  = ["node", "apps/api/dist/worker-main.js"]
    migrate = ["node", "apps/api/dist/migrate-main.js"]
  }
}

resource "aws_ecs_cluster" "main" {
  name = local.name
  tags = local.tags

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  service_connect_defaults {
    namespace = aws_service_discovery_http_namespace.main.arn
  }
}

# Nome interno da API para a web (MEUREMEDIO_API_URL=http://api:3000).
resource "aws_service_discovery_http_namespace" "main" {
  name = local.name
  tags = local.tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api_task.arn
  tags                     = local.tags

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name                   = "api"
    image                  = var.api_image
    command                = local.api_command.api
    essential              = true
    user                   = "node"
    readonlyRootFilesystem = true
    linuxParameters        = { initProcessEnabled = true }
    portMappings           = [{ name = "http", containerPort = 3000, protocol = "tcp" }]
    environment = concat(local.common_env, local.storage_env, [
      { name = "PORT", value = "3000" },
      { name = "ALLOWED_ORIGINS", value = local.web_origin },
      { name = "RIGHTS_CHANNEL_URL", value = var.rights_channel_url },
    ])
    secrets          = local.api_secrets
    logConfiguration = local.log_options["api"]
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn
  tags                     = local.tags

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name                   = "worker"
    image                  = var.api_image
    command                = local.api_command.worker
    essential              = true
    user                   = "node"
    readonlyRootFilesystem = true
    linuxParameters        = { initProcessEnabled = true }
    environment = concat(local.common_env, local.storage_env, [
      { name = "WEB_BASE_URL", value = local.web_origin },
      { name = "EMAIL_PROVIDER", value = "ses" },
      { name = "EMAIL_FROM", value = var.email_from },
      { name = "EMAIL_CONFIGURATION_SET", value = aws_sesv2_configuration_set.main.configuration_set_name },
    ])
    secrets = concat(local.database_secrets, [
      { name = "EMAIL_PEPPER", valueFrom = "${aws_secretsmanager_secret.app["EMAIL_PEPPER"].arn}:current::" },
    ])
    logConfiguration = local.log_options["worker"]
  }])
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.migrate_task.arn
  tags                     = local.tags

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name                   = "migrate"
    image                  = var.api_image
    command                = local.api_command.migrate
    essential              = true
    user                   = "node"
    readonlyRootFilesystem = true
    environment            = local.common_env
    secrets                = local.database_secrets
    logConfiguration       = local.log_options["migrate"]
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web_task.arn
  tags                     = local.tags

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  # O next start escreve o cache em .next/cache: sistema de arquivos gravavel so aqui.
  container_definitions = jsonencode([{
    name                   = "web"
    image                  = var.web_image
    essential              = true
    user                   = "node"
    readonlyRootFilesystem = false
    linuxParameters        = { initProcessEnabled = true }
    portMappings           = [{ name = "http", containerPort = 3001, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "MEUREMEDIO_API_URL", value = "http://api:3000" },
    ]
    logConfiguration = local.log_options["web"]
  }])
}

resource "aws_ecs_service" "api" {
  name                   = "api"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.api.arn
  desired_count          = var.api_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"
  tags                   = local.tags

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn

    service {
      port_name      = "http"
      discovery_name = "api"

      client_alias {
        port     = 3000
        dns_name = "api"
      }
    }
  }
}

resource "aws_ecs_service" "worker" {
  name                   = "worker"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.worker.arn
  desired_count          = var.worker_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"
  tags                   = local.tags

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

resource "aws_ecs_service" "web" {
  name                   = "web"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.web.arn
  desired_count          = var.web_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = false
  propagate_tags         = "SERVICE"
  tags                   = local.tags

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.web.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3001
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn
  }

  depends_on = [aws_lb_listener.https]
}
