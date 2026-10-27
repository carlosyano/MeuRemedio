#!/bin/bash
# Implantacao de um ambiente (DC-072), chamada pelo workflow deploy depois de assumir o papel do
# CD por OIDC. Ordem: imagens no ECR por digest, varredura sem achado CRITICAL, migracao como
# tarefa avulsa (falha aborta antes de tocar nos servicos), terraform apply e espera dos servicos.
# Entradas: ENVIRONMENT, TF_STATE_BUCKET e as TF_VAR_* do environment do GitHub.
set -euo pipefail

: "${ENVIRONMENT:?ENVIRONMENT nao definida}"
: "${TF_STATE_BUCKET:?TF_STATE_BUCKET nao definida}"
REGION="sa-east-1"
TF_DIR="infra/terraform/envs/$ENVIRONMENT"
SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"

TERRAFORM="$(node --input-type=module -e \
  "import('./tools/scripts/terraform-bin.mjs').then(async (m) => console.log(await m.ensureTerraform(process.cwd())))")"
tf() { "$TERRAFORM" -chdir="$TF_DIR" "$@"; }

tf init -input=false -lockfile=readonly \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=$ENVIRONMENT/terraform.tfstate" \
  -backend-config="region=$REGION" \
  -backend-config="encrypt=true" \
  -backend-config="use_lockfile=true"

out() { tf output -json platform | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)['$1'];console.log(Array.isArray(v)?v.join(','):v)})"; }
API_REPO="$(out ecr_api_repository_url)"
WEB_REPO="$(out ecr_web_repository_url)"
CLUSTER="$(out cluster_name)"
SUBNETS="$(out private_subnet_ids)"
WORKER_SG="$(out worker_security_group_id)"

aws ecr get-login-password --region "$REGION" |
  docker login --username AWS --password-stdin "${API_REPO%%/*}"

# Imagens com a tag do commit (ECR imutavel) e referencia por digest no Terraform.
docker build --target api -t "$API_REPO:$SHA" .
docker build --target web --build-arg MEUREMEDIO_API_URL=http://api:3000 -t "$WEB_REPO:$SHA" .
docker push "$API_REPO:$SHA"
docker push "$WEB_REPO:$SHA"
API_IMAGE="$(docker inspect --format '{{index .RepoDigests 0}}' "$API_REPO:$SHA")"
WEB_IMAGE="$(docker inspect --format '{{index .RepoDigests 0}}' "$WEB_REPO:$SHA")"

# Varredura do ECR: achado CRITICAL bloqueia a implantacao.
for repo in "$API_REPO" "$WEB_REPO"; do
  name="${repo#*/}"
  aws ecr wait image-scan-complete --region "$REGION" --repository-name "$name" --image-id imageTag="$SHA"
  critical="$(aws ecr describe-image-scan-findings --region "$REGION" --repository-name "$name" \
    --image-id imageTag="$SHA" --query 'imageScanFindings.findingSeverityCounts.CRITICAL' --output text)"
  if [ "$critical" != "None" ] && [ "$critical" != "0" ]; then
    echo "deploy: $name:$SHA tem $critical achado(s) CRITICAL na varredura do ECR" >&2
    exit 1
  fi
done

export TF_VAR_api_image="$API_IMAGE" TF_VAR_web_image="$WEB_IMAGE"

# Migracao antes dos servicos: so a definicao da tarefa de migracao recebe a imagem nova.
tf apply -input=false -auto-approve -target=module.platform.aws_ecs_task_definition.migrate
MIGRATE_TD="$(out migrate_task_definition_arn)"
TASK="$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$MIGRATE_TD" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$WORKER_SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK"
EXIT_CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
if [ "$EXIT_CODE" != "0" ]; then
  echo "deploy: a migracao terminou com codigo $EXIT_CODE; servicos mantidos na versao anterior" >&2
  exit 1
fi

tf apply -input=false -auto-approve
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services api worker web
echo "deploy: $ENVIRONMENT em $SHA"
