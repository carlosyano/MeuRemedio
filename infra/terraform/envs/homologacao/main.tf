# Ambiente de homologacao (DC-071). Os valores ficam em terraform.tfvars (fora do repositorio;
# modelo em terraform.tfvars.example). As credenciais vem do papel assumido pelo CD via OIDC ou
# do perfil do operador, nunca de chave no codigo.
provider "aws" {
  region = "sa-east-1"

  default_tags {
    tags = {
      Project     = "meuremedio"
      Environment = "homologacao"
    }
  }
}

module "platform" {
  source = "../../modules/platform"

  environment        = "homologacao"
  domain_name        = var.domain_name
  hosted_zone_id     = var.hosted_zone_id
  email_from         = var.email_from
  email_domain       = var.email_domain
  rights_channel_url = var.rights_channel_url
  api_image          = var.api_image
  web_image          = var.web_image

  github_oidc_provider_arn = aws_iam_openid_connect_provider.github.arn

  # homologacao: uma zona de saida e uma tarefa por servico, para custo menor
  single_nat_gateway   = true
  db_multi_az          = false
  api_desired_count    = 1
  web_desired_count    = 1
  worker_desired_count = 1
}
