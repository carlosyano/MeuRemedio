# Segredos HMAC da aplicacao (TS-031, DC-065). O Terraform cria so o recipiente; o valor
# {"current": "<base64>", "previous": "<base64,...>"} e gravado pelo operador
# (docs/operations/KEY_ROTATION.md) e nunca passa pelo estado.
resource "aws_secretsmanager_secret" "app" {
  for_each                = toset(local.app_secrets)
  name                    = "${local.name}/${each.key}"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 30
  tags                    = local.tags
}
