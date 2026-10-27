# SES (OA-004, DC-069): dominio com DKIM no Route 53 e configuration set com metricas de
# reputacao e supressao de bounce e reclamacao. A saida do sandbox do SES e pedida a AWS fora do
# Terraform. A conciliacao pelos eventos (DEC-005) ainda nao tem consumidor na aplicacao.
# Identidade e DKIM pela API v1 do SES (o atributo dkim_tokens e uma lista calculada, que o plano
# trata melhor que o bloco da v2); a identidade e a mesma para o envio pela API v2.
resource "aws_ses_domain_identity" "main" {
  domain = var.email_domain
}

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = var.hosted_zone_id
  name    = "${aws_ses_domain_dkim.main.dkim_tokens[count.index]}._domainkey.${var.email_domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.main.dkim_tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_sesv2_configuration_set" "main" {
  configuration_set_name = local.name
  tags                   = local.tags

  delivery_options {
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}
