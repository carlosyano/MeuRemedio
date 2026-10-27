# Logs por processo, cifrados e com retencao definida (provisoria ate o GX-003).
resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "worker", "web", "migrate"])
  name              = "/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
  tags              = local.tags
}
