# Plataforma MeuRemedio na AWS (ADR-001 v1.5 OA-010, DC-071): rede propria em duas zonas, RDS
# PostgreSQL 17, S3 privado das exportacoes, SES, ECS Fargate (API, worker, web e a tarefa de
# migracao), ALB com TLS 1.3, ECR, Secrets Manager e CloudWatch, tudo cifrado com uma chave KMS
# do projeto.

locals {
  name = "meuremedio-${var.environment}"

  tags = {
    Project     = "meuremedio"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # Segredos HMAC da aplicacao (TS-031, DC-065): cada um guarda o JSON {"current","previous"}.
  # O valor e gravado fora do Terraform (docs/operations/KEY_ROTATION.md) e nunca vai para o estado.
  app_secrets = ["CSRF_KEY", "REQUEST_HASH_KEY", "EMAIL_PEPPER"]

  web_origin = "https://${var.domain_name}"
}

data "aws_caller_identity" "current" {}
