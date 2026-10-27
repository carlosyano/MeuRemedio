# infra/terraform

Infraestrutura da plataforma MeuRemedio na AWS (ADR-001 v1.5 OA-010; decisão DC-071 em `docs/decisions/DECISOES_CLAUDE.md`).

- `modules/platform`: a plataforma inteira de um ambiente, com rede em duas zonas, RDS PostgreSQL 17, S3 privado das exportações, SES, ECS Fargate (API, worker, web e a tarefa de migração), ALB com TLS 1.3, ECR, Secrets Manager, CloudWatch e uma chave KMS do projeto.
- `modules/platform/tests`: `terraform test` com provedor simulado. Prova as propriedades de segurança sem credencial da AWS.
- `envs/homologacao`: o ambiente de homologação. A produção entra quando o GX-001 a GX-006 permitirem.

Verificação local e na CI: `npm run infra:check` (formato, `validate` e testes). O script baixa o Terraform fixado e confere o SHA-256 (`tools/scripts/terraform-bin.mjs`).

## O que o mantenedor precisa fornecer

Nada disso pode ser feito pelo agente:

1. **Conta AWS** com acesso de administrador para a primeira aplicação, na região `sa-east-1`.
2. **Domínio** com zona no Route 53 (`hosted_zone_id`), para o certificado do ALB, o DKIM do SES e o endereço da aplicação.
3. **Saída do sandbox do SES**, pedida no console da AWS. Sem isso, o SES só entrega para endereços verificados.
4. **Os valores dos segredos HMAC**, gravados no Secrets Manager depois da primeira aplicação (`docs/operations/KEY_ROTATION.md` §5).

## Primeira implantação (homologação)

1. Criar à mão o bucket do estado do Terraform, com versionamento, cifragem padrão e bloqueio de acesso público. Depois, copiar `envs/homologacao/backend.hcl.example` para `backend.hcl`.
2. Copiar `envs/homologacao/terraform.tfvars.example` para `terraform.tfvars` e preencher.
3. `terraform init -backend-config=backend.hcl` e `terraform apply` em `envs/homologacao`. Na primeira vez, as tarefas não sobem, porque ainda não há imagem no ECR nem valor nos segredos.
4. Gravar os três segredos HMAC (`KEY_ROTATION.md` §5).
5. Publicar as imagens e implantar pelo CD. A migração roda como tarefa avulsa antes dos serviços. A imagem da web é construída com `MEUREMEDIO_API_URL=http://api:3000`, o nome interno da API no Service Connect.

## Decisões e limites

- O navegador fala só com a web (OA-008). A API não tem entrada pública: recebe só da web, pelo Service Connect.
- O banco exige TLS (`rds.force_ssl`). A aplicação verifica o certificado contra a CA do RDS embarcada na imagem (`apps/api/assets/rds-ca-sa-east-1.pem`). Usuário e senha vêm do segredo gerenciado pelo RDS, em `PGUSER` e `PGPASSWORD`.
- Hoje a aplicação e a migração usam o usuário mestre do banco. Um papel próprio com menos privilégio fica como pendência (DC-071).
- Ficam fora deste módulo: WAF, alarmes do CloudWatch, backup entre regiões e o consumidor dos eventos do SES para a conciliação (DEC-005).
- Custo: o NAT gateway e o RDS dominam o custo mínimo. Em homologação ficam um NAT só e o RDS sem Multi-AZ.
