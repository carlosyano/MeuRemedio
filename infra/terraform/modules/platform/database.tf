# RDS PostgreSQL 17 privado, cifrado com a chave do projeto, TLS obrigatorio e senha mestre
# gerenciada pelo RDS no Secrets Manager (nunca no estado do Terraform).
resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
  tags       = local.tags
}

resource "aws_db_parameter_group" "main" {
  name   = local.name
  family = "postgres17"
  tags   = local.tags

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Sem o texto das consultas nos logs: os parametros podem levar dado do titular.
  parameter {
    name  = "log_statement"
    value = "none"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "-1"
  }
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class
  db_name        = "meuremedio"
  username       = "meuremedio"

  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.main.arn

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_allocated_storage * 5
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period    = var.db_backup_retention_days
  copy_tags_to_snapshot      = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-final"
  auto_minor_version_upgrade = true
  apply_immediately          = false

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.main.arn
  performance_insights_retention_period = 7

  tags = local.tags
}
