# Entradas do modulo da plataforma MeuRemedio (DC-071). Valores de cada ambiente ficam em
# infra/terraform/envs/<ambiente>; nenhum segredo entra por variavel.

variable "environment" {
  description = "Nome curto do ambiente (homologacao ou producao)."
  type        = string

  validation {
    condition     = contains(["homologacao", "producao"], var.environment)
    error_message = "environment deve ser homologacao ou producao."
  }
}

variable "region" {
  description = "Regiao da AWS (ADR-001 OA-010: sa-east-1)."
  type        = string
  default     = "sa-east-1"

  validation {
    # a CA do RDS embarcada na imagem e a de sa-east-1 (apps/api/assets/rds-ca-sa-east-1.pem)
    condition     = var.region == "sa-east-1"
    error_message = "A plataforma roda em sa-east-1 (ADR-001 OA-010)."
  }
}

variable "availability_zones" {
  description = "Duas zonas de disponibilidade da regiao."
  type        = list(string)
  default     = ["sa-east-1a", "sa-east-1b"]

  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "Informe exatamente duas zonas de disponibilidade."
  }
}

variable "vpc_cidr" {
  description = "Bloco CIDR da VPC (/16)."
  type        = string
  default     = "10.40.0.0/16"
}

variable "domain_name" {
  description = "Dominio publico da aplicacao web (ex.: app.exemplo.com.br). A origem unica do navegador."
  type        = string
}

variable "hosted_zone_id" {
  description = "Zona do Route 53 que responde pelo dominio (validacao do certificado, DKIM e alias)."
  type        = string
}

variable "email_from" {
  description = "Remetente dos e-mails, no dominio verificado no SES (ex.: nao-responda@exemplo.com.br)."
  type        = string
}

variable "email_domain" {
  description = "Dominio verificado no SES para o remetente."
  type        = string
}

variable "rights_channel_url" {
  description = "Canal externo dos direitos do titular (GX-002), exposto por getPrivacy."
  type        = string
}

variable "api_image" {
  description = "Imagem da API (alvo api do Dockerfile), de preferencia por digest. Tambem roda worker, migracao e ops."
  type        = string
}

variable "web_image" {
  description = "Imagem da web (alvo web do Dockerfile), construida com MEUREMEDIO_API_URL=http://api:3000."
  type        = string
}

variable "db_instance_class" {
  description = "Classe da instancia do RDS PostgreSQL 17."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Armazenamento inicial do RDS em GiB."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "RDS em Multi-AZ (recomendado em producao; depende do RPO e RTO do GX-005)."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Retencao dos backups automaticos do RDS (provisoria ate o GX-003)."
  type        = number
  default     = 7

  validation {
    condition     = var.db_backup_retention_days >= 7 && var.db_backup_retention_days <= 35
    error_message = "A retencao dos backups fica entre 7 e 35 dias."
  }
}

variable "log_retention_days" {
  description = "Retencao dos logs no CloudWatch (provisoria ate o GX-003)."
  type        = number
  default     = 180
}

variable "api_desired_count" {
  description = "Tarefas da API."
  type        = number
  default     = 2
}

variable "web_desired_count" {
  description = "Tarefas da web."
  type        = number
  default     = 2
}

variable "worker_desired_count" {
  description = "Tarefas do worker (os jobs agendados do pg-boss toleram mais de uma)."
  type        = number
  default     = 1
}

variable "single_nat_gateway" {
  description = "Um NAT gateway so (mais barato, sem redundancia de saida); false cria um por zona."
  type        = bool
  default     = true
}

variable "github_repository" {
  description = "Repositorio do GitHub (dono/nome) cujo workflow de deploy assume o papel de implantacao."
  type        = string
  default     = "carlosyano/MeuRemedio"
}

variable "github_oidc_provider_arn" {
  description = "ARN do provedor OIDC do GitHub Actions na conta (um por conta; criado no ambiente)."
  type        = string
}
