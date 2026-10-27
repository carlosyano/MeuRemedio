# Provedor OIDC do GitHub Actions (DC-072): um por conta da AWS. Se a producao ficar na mesma
# conta, ela referencia este provedor em vez de criar outro.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}
