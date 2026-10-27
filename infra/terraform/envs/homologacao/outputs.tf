output "platform" {
  description = "Saidas do modulo usadas pelo CD e pela operacao."
  value = {
    ecr_api_repository_url      = module.platform.ecr_api_repository_url
    ecr_web_repository_url      = module.platform.ecr_web_repository_url
    cluster_name                = module.platform.cluster_name
    migrate_task_definition_arn = module.platform.migrate_task_definition_arn
    private_subnet_ids          = module.platform.private_subnet_ids
    worker_security_group_id    = module.platform.worker_security_group_id
    app_secret_arns             = module.platform.app_secret_arns
    exports_bucket              = module.platform.exports_bucket
    web_url                     = module.platform.web_url
  }
}
