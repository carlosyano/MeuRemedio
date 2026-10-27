variable "domain_name" {
  description = "Dominio da aplicacao web em homologacao."
  type        = string
}

variable "hosted_zone_id" {
  description = "Zona do Route 53 do dominio."
  type        = string
}

variable "email_from" {
  description = "Remetente dos e-mails."
  type        = string
}

variable "email_domain" {
  description = "Dominio do remetente verificado no SES."
  type        = string
}

variable "rights_channel_url" {
  description = "Canal externo dos direitos do titular (GX-002)."
  type        = string
}

variable "api_image" {
  description = "Imagem da API no ECR, por digest (o CD informa)."
  type        = string
}

variable "web_image" {
  description = "Imagem da web no ECR, por digest (o CD informa)."
  type        = string
}
