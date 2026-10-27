# Saidas usadas pelo CD (DC-071) e pela operacao.
output "ecr_api_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition_arn" {
  value = aws_ecs_task_definition.migrate.arn
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "worker_security_group_id" {
  description = "Grupo da tarefa de migracao e dos scripts de operacao (npm run ops)."
  value       = aws_security_group.worker.id
}

output "app_secret_arns" {
  description = "Recipientes dos segredos HMAC; o valor e gravado pelo operador (KEY_ROTATION.md)."
  value       = { for name, secret in aws_secretsmanager_secret.app : name => secret.arn }
}

output "exports_bucket" {
  value = aws_s3_bucket.exports.bucket
}

output "web_url" {
  value = local.web_origin
}
