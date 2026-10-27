# Papeis das tarefas (RNF-003 menor privilegio): o papel de execucao so puxa imagem, le os
# segredos e escreve logs; cada processo tem o proprio papel de tarefa com o minimo que usa.
locals {
  ecs_assume_role = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })

  exports_objects = "${aws_s3_bucket.exports.arn}/exports/*"

  # PutObject/GetObject/DeleteObject no prefixo e ListBucket restrito a ele: sem o ListBucket, o S3
  # responde AccessDenied em vez de NoSuchKey para objeto inexistente (DC-068).
  exports_statements = [
    {
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
      Resource = local.exports_objects
    },
    {
      Effect    = "Allow"
      Action    = "s3:ListBucket"
      Resource  = aws_s3_bucket.exports.arn
      Condition = { StringLike = { "s3:prefix" = ["exports/*"] } }
    },
    {
      Effect   = "Allow"
      Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
      Resource = aws_kms_key.main.arn
    },
  ]
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = local.ecs_assume_role
  tags               = local.tags
}

resource "aws_iam_role_policy" "execution" {
  name = "execucao"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = [aws_ecr_repository.api.arn, aws_ecr_repository.web.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [for group in aws_cloudwatch_log_group.app : "${group.arn}:*"]
      },
      {
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = concat(
          [for secret in aws_secretsmanager_secret.app : secret.arn],
          [aws_db_instance.main.master_user_secret[0].secret_arn],
        )
      },
      {
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.main.arn
      },
    ]
  })
}

resource "aws_iam_role" "api_task" {
  name               = "${local.name}-api"
  assume_role_policy = local.ecs_assume_role
  tags               = local.tags
}

resource "aws_iam_role_policy" "api_task" {
  name   = "api"
  role   = aws_iam_role.api_task.id
  policy = jsonencode({ Version = "2012-10-17", Statement = local.exports_statements })
}

resource "aws_iam_role" "worker_task" {
  name               = "${local.name}-worker"
  assume_role_policy = local.ecs_assume_role
  tags               = local.tags
}

resource "aws_iam_role_policy" "worker_task" {
  name = "worker"
  role = aws_iam_role.worker_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(local.exports_statements, [{
      Effect = "Allow"
      Action = "ses:SendEmail"
      Resource = [
        aws_ses_domain_identity.main.arn,
        aws_sesv2_configuration_set.main.arn,
      ]
      Condition = { StringEquals = { "ses:FromAddress" = var.email_from } }
    }])
  })
}

# A web e a migracao nao chamam servicos da AWS: papel de tarefa sem politica.
resource "aws_iam_role" "web_task" {
  name               = "${local.name}-web"
  assume_role_policy = local.ecs_assume_role
  tags               = local.tags
}

resource "aws_iam_role" "migrate_task" {
  name               = "${local.name}-migrate"
  assume_role_policy = local.ecs_assume_role
  tags               = local.tags
}
