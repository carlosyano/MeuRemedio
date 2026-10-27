# Papel do CD (DC-072): o workflow deploy do GitHub Actions o assume por OIDC, sem chave de acesso
# guardada. A confianca exige o repositorio e o environment do GitHub deste ambiente, que tem
# revisor obrigatorio; nenhuma branch, PR ou fork assume o papel.
resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-deploy"
  max_session_duration = 3600
  tags                 = local.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.environment}"
        }
      }
    }]
  })
}

# O terraform apply do CD gerencia todos os servicos do modulo: PowerUser (tudo menos IAM e
# Organizations) mais o IAM restrito aos papeis do proprio ambiente. Na pratica, o papel e
# equivalente a administrador do ambiente; o controle e a aprovacao no environment do GitHub.
resource "aws_iam_role_policy_attachment" "deploy_power_user" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy" "deploy_iam" {
  name = "iam-do-ambiente"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "iam:GetRole", "iam:CreateRole", "iam:DeleteRole", "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
          "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole",
          "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PassRole",
        ]
        Resource = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.name}-*"
      },
      {
        Effect   = "Allow"
        Action   = ["iam:GetOpenIDConnectProvider", "iam:ListOpenIDConnectProviders"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = "iam:CreateServiceLinkedRole"
        Resource = "*"
        Condition = {
          StringLike = {
            "iam:AWSServiceName" = [
              "ecs.amazonaws.com", "elasticloadbalancing.amazonaws.com", "rds.amazonaws.com",
            ]
          }
        }
      },
    ]
  })
}
