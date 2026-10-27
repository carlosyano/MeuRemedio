# Propriedades de seguranca da plataforma (DC-071), com provedor simulado: o apply roda contra
# o mock_provider, sem credencial da AWS e sem criar nada. Cada bloco prova uma regra do AGENTS.md, da ADR-001 ou dos
# RNF (criptografia, isolamento de rede, menor privilegio, sem segredo em texto claro).

mock_provider "aws" {
  # ARNs em formato valido: o provedor valida os ARNs recebidos por outros recursos.
  mock_resource "aws_kms_key" {
    defaults = {
      arn = "arn:aws:kms:sa-east-1:111111111111:key/00000000-0000-0000-0000-000000000000"
    }
  }

  mock_resource "aws_lb" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:sa-east-1:111111111111:loadbalancer/app/meuremedio/0000000000000000"
    }
  }

  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:sa-east-1:111111111111:targetgroup/meuremedio/0000000000000000"
    }
  }

  mock_resource "aws_service_discovery_http_namespace" {
    defaults = {
      arn = "arn:aws:servicediscovery:sa-east-1:111111111111:namespace/ns-0000000000000000"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::111111111111:role/meuremedio"
    }
  }

  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn = "arn:aws:ecs:sa-east-1:111111111111:cluster/meuremedio"
    }
  }

  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn = "arn:aws:ecs:sa-east-1:111111111111:task-definition/meuremedio:1"
    }
  }

  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::meuremedio-homologacao-exports-0000"
    }
  }

  mock_resource "aws_secretsmanager_secret" {
    defaults = {
      arn = "arn:aws:secretsmanager:sa-east-1:111111111111:secret:meuremedio-0000"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:sa-east-1:111111111111:log-group:/meuremedio"
    }
  }

  mock_resource "aws_ecr_repository" {
    defaults = {
      arn = "arn:aws:ecr:sa-east-1:111111111111:repository/meuremedio"
    }
  }

  mock_resource "aws_ses_domain_identity" {
    defaults = {
      arn = "arn:aws:ses:sa-east-1:111111111111:identity/exemplo.com.br"
    }
  }

  mock_resource "aws_sesv2_configuration_set" {
    defaults = {
      arn = "arn:aws:ses:sa-east-1:111111111111:configuration-set/meuremedio"
    }
  }

  override_resource {
    target = aws_db_instance.main
    values = {
      address = "meuremedio-homologacao.abc123.sa-east-1.rds.amazonaws.com"
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:sa-east-1:111111111111:secret:rds-master-abc"
        kms_key_id    = "arn:aws:kms:sa-east-1:111111111111:key/rds"
        secret_status = "active"
      }]
    }
  }

  override_resource {
    target = aws_ses_domain_dkim.main
    values = {
      dkim_tokens = ["tokena", "tokenb", "tokenc"]
    }
  }
}

# Valores calculados que o mock nao gera em formato valido (listas, ARNs validados).
override_resource {
  target = aws_acm_certificate.web
  values = {
    arn = "arn:aws:acm:sa-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
    domain_validation_options = [{
      domain_name           = "app.exemplo.com.br"
      resource_record_name  = "_abc.app.exemplo.com.br."
      resource_record_type  = "CNAME"
      resource_record_value = "_xyz.acm-validations.aws."
    }]
  }
}

variables {
  environment        = "homologacao"
  domain_name        = "app.exemplo.com.br"
  hosted_zone_id     = "Z0000000000000000000"
  email_from         = "nao-responda@exemplo.com.br"
  email_domain       = "exemplo.com.br"
  rights_channel_url = "https://exemplo.com.br/privacidade"
  api_image          = "111111111111.dkr.ecr.sa-east-1.amazonaws.com/meuremedio-api@sha256:0000000000000000000000000000000000000000000000000000000000000000"
  web_image          = "111111111111.dkr.ecr.sa-east-1.amazonaws.com/meuremedio-web@sha256:0000000000000000000000000000000000000000000000000000000000000000"
}

run "chave_kms_com_rotacao" {
  command = apply

  assert {
    condition     = aws_kms_key.main.enable_key_rotation
    error_message = "A chave KMS precisa de rotacao automatica (RNF-012)."
  }
}

run "bucket_das_exportacoes_privado_e_cifrado" {
  command = apply

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.exports.block_public_acls,
      aws_s3_bucket_public_access_block.exports.block_public_policy,
      aws_s3_bucket_public_access_block.exports.ignore_public_acls,
      aws_s3_bucket_public_access_block.exports.restrict_public_buckets,
    ])
    error_message = "O bucket das exportacoes bloqueia todo acesso publico."
  }

  assert {
    condition = one([
      for rule in aws_s3_bucket_server_side_encryption_configuration.exports.rule :
      one(rule.apply_server_side_encryption_by_default).sse_algorithm
    ]) == "aws:kms"
    error_message = "Cifragem padrao do bucket com KMS (RNF-002)."
  }

  assert {
    condition     = strcontains(aws_s3_bucket_policy.exports.policy, "aws:SecureTransport")
    error_message = "A politica do bucket recusa acesso sem TLS."
  }

  assert {
    condition     = strcontains(aws_s3_bucket_policy.exports.policy, "s3:x-amz-server-side-encryption")
    error_message = "A politica do bucket recusa envio sem SSE-KMS (DC-068)."
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.exports.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "ACLs desligadas no bucket."
  }
}

run "banco_privado_cifrado_e_com_tls" {
  command = apply

  assert {
    condition     = aws_db_instance.main.storage_encrypted && !aws_db_instance.main.publicly_accessible
    error_message = "RDS cifrado e sem acesso publico."
  }

  assert {
    condition     = startswith(aws_db_instance.main.engine_version, "17")
    error_message = "PostgreSQL 17 (ADR-001)."
  }

  assert {
    condition     = aws_db_instance.main.deletion_protection && aws_db_instance.main.backup_retention_period >= 7
    error_message = "Protecao contra exclusao e backups de pelo menos 7 dias."
  }

  assert {
    condition     = aws_db_instance.main.manage_master_user_password
    error_message = "Senha mestre gerenciada pelo RDS no Secrets Manager, fora do estado do Terraform."
  }

  assert {
    condition = anytrue([
      for p in aws_db_parameter_group.main.parameter : p.name == "rds.force_ssl" && p.value == "1"
    ])
    error_message = "O banco recusa conexao sem TLS."
  }
}

run "https_com_tls_1_3_e_http_redireciona" {
  command = apply

  assert {
    condition     = aws_lb_listener.https.protocol == "HTTPS" && aws_lb_listener.https.ssl_policy == "ELBSecurityPolicy-TLS13-1-3-2021-06"
    error_message = "HTTPS so com TLS 1.3 (RNF-002)."
  }

  assert {
    condition     = one(aws_lb_listener.http.default_action).type == "redirect"
    error_message = "HTTP so redireciona para HTTPS."
  }

  assert {
    condition     = aws_lb.web.drop_invalid_header_fields
    error_message = "O balanceador descarta cabecalhos invalidos."
  }
}

run "rede_isolada_por_camada" {
  command = apply

  assert {
    condition = alltrue([
      for rule in [aws_vpc_security_group_ingress_rule.api_from_web] :
      rule.referenced_security_group_id == aws_security_group.web.id && rule.cidr_ipv4 == null
    ])
    error_message = "A API so recebe da web (o navegador fala so com a origem da aplicacao)."
  }

  assert {
    condition = alltrue([
      for rule in values(aws_vpc_security_group_ingress_rule.db_from_app) : rule.cidr_ipv4 == null
    ]) && length(aws_vpc_security_group_ingress_rule.db_from_app) == 2
    error_message = "O banco so recebe da API e do worker."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.web_from_alb.referenced_security_group_id == aws_security_group.alb.id
    error_message = "A web so recebe do balanceador."
  }

  assert {
    condition = alltrue([
      for service in [aws_ecs_service.api, aws_ecs_service.web, aws_ecs_service.worker] :
      !one(service.network_configuration).assign_public_ip
    ])
    error_message = "Nenhuma tarefa tem IP publico."
  }
}

run "tarefas_sem_segredo_em_texto_claro_e_sem_root" {
  command = apply

  assert {
    condition = alltrue(flatten([
      for td in [aws_ecs_task_definition.api, aws_ecs_task_definition.worker, aws_ecs_task_definition.migrate] : [
        for c in jsondecode(td.container_definitions) : [
          for e in c.environment : !contains(["CSRF_KEY", "REQUEST_HASH_KEY", "EMAIL_PEPPER", "PGPASSWORD"], e.name)
        ]
      ]
    ]))
    error_message = "Segredos so entram pelo Secrets Manager (campo secrets), nunca em environment."
  }

  assert {
    condition = alltrue([
      for td in [aws_ecs_task_definition.api, aws_ecs_task_definition.worker, aws_ecs_task_definition.migrate, aws_ecs_task_definition.web] :
      alltrue([for c in jsondecode(td.container_definitions) : c.user == "node"])
    ])
    error_message = "Os containers rodam como o usuario node."
  }

  assert {
    condition = alltrue([
      for td in [aws_ecs_task_definition.api, aws_ecs_task_definition.worker, aws_ecs_task_definition.migrate] :
      alltrue([for c in jsondecode(td.container_definitions) : c.readonlyRootFilesystem])
    ])
    error_message = "API, worker e migracao com sistema de arquivos somente leitura."
  }

  assert {
    condition = contains(
      [for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.name],
      "CSRF_KEY_PREVIOUS",
    )
    error_message = "A API recebe as chaves anteriores da rotacao (DC-065)."
  }
}

run "menor_privilegio_nos_papeis" {
  command = apply

  assert {
    condition     = !strcontains(aws_iam_role_policy.api_task.policy, "ses:")
    error_message = "A API nao envia e-mail; so o worker."
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.worker_task.policy, "ses:SendEmail")
    error_message = "O worker envia e-mail pelo SES."
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.api_task.policy, "s3:ListBucket") && strcontains(aws_iam_role_policy.api_task.policy, "exports/*")
    error_message = "ListBucket restrito ao prefixo exports/ (DC-068: objeto inexistente vira 404)."
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.api_task.policy, "\"*\"")
    error_message = "Nenhuma permissao da API em todos os recursos."
  }
}

run "imagens_e_logs" {
  command = apply

  assert {
    condition = alltrue([
      for repo in [aws_ecr_repository.api, aws_ecr_repository.web] :
      repo.image_tag_mutability == "IMMUTABLE" && one(repo.image_scanning_configuration).scan_on_push
    ])
    error_message = "ECR com tags imutaveis e varredura no envio."
  }

  assert {
    condition = alltrue([
      for group in values(aws_cloudwatch_log_group.app) : group.retention_in_days == 180 && group.kms_key_id != null
    ])
    error_message = "Logs com retencao definida e cifrados com KMS."
  }
}

run "producao_exige_ambiente_valido" {
  command = plan

  variables {
    environment = "teste"
  }

  expect_failures = [var.environment]
}
