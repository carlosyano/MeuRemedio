terraform {
  required_version = ">= 1.16.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.68.0"
    }
  }

  # Estado remoto no S3 com trava nativa (use_lockfile). Bucket, chave e regiao em backend.hcl
  # (fora do repositorio; modelo em backend.hcl.example): terraform init -backend-config=backend.hcl
  backend "s3" {}
}
