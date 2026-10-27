#!/bin/bash
# Prepara o container Linux das sessoes do Claude Code na nuvem para rodar
# verify, validate_all.py e test:integration. Idempotente.
# Uso manual: bash tools/scripts/cloud-setup.sh e depois o export que ele imprime.
# Pode ser registrado como hook SessionStart; nesse caso grava o PATH em
# $CLAUDE_ENV_FILE.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Node 24 fixado com SHA-256 conferido (o container vem com outra major).
# Atualizar = trocar versao e hash no mesmo PR (mesma politica do oasdiff).
NODE_VERSION="v24.22.1"
NODE_SHA256="6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6"
NODE_DIR="$HOME/.cache/meuremedio/node-$NODE_VERSION-linux-x64"

if [ ! -x "$NODE_DIR/bin/node" ]; then
  tmp="$(mktemp -d)"
  tarball="node-$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL --retry 3 -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  # divergencia de hash aborta antes de extrair
  echo "$NODE_SHA256  $tmp/$tarball" | sha256sum -c --quiet -
  mkdir -p "$(dirname "$NODE_DIR")"
  tar -xJf "$tmp/$tarball" -C "$(dirname "$NODE_DIR")"
  rm -rf "$tmp"
fi
export PATH="$NODE_DIR/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# Docker para o Testcontainers dos testes de integracao
if ! docker info > /dev/null 2>&1; then
  # pid de uma sessao anterior (o numero pode ter sido reusado) impede a subida do dockerd
  pgrep -x dockerd > /dev/null || rm -f /var/run/docker.pid
  nohup dockerd > /tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info > /dev/null 2>&1 && break
    sleep 1
  done
fi

# postgres:17: o Docker Hub costuma responder 429 neste ambiente, entao cai
# para o espelho do Google e marca a imagem com o nome que o testkit usa.
if docker info > /dev/null 2>&1 && ! docker image inspect postgres:17 > /dev/null 2>&1; then
  if ! docker pull -q postgres:17 > /dev/null 2>&1; then
    docker pull -q mirror.gcr.io/library/postgres:17 > /dev/null
    docker tag mirror.gcr.io/library/postgres:17 postgres:17
  fi
fi

# Build das imagens (DC-070) neste ambiente: base pelo espelho, com o mesmo digest do Dockerfile,
# e a CA do proxy de saida para o npm ci dentro do build.
BASE_DIGEST="$(sed -n 's/^ARG BASE_IMAGE=node:[^@]*@//p' Dockerfile)"
BASE_TAG="$(sed -n 's/^ARG BASE_IMAGE=node:\([^@]*\)@.*/\1/p' Dockerfile)"
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -n "$BASE_DIGEST" ]; then
  echo "export MEUREMEDIO_BASE_IMAGE=mirror.gcr.io/library/node:$BASE_TAG@$BASE_DIGEST" >> "$CLAUDE_ENV_FILE"
  if [ -f /root/.ccr/ca-bundle.crt ]; then
    echo "export MEUREMEDIO_BUILD_CA=/root/.ccr/ca-bundle.crt" >> "$CLAUDE_ENV_FILE"
  fi
fi

# Dependencias npm exatas do lockfile (nunca reescreve o package-lock.json)
npm ci --no-audit --no-fund

# Dependencias do validador da matriz
if ! python3 -c "import yaml, jsonschema" > /dev/null 2>&1; then
  python3 -m pip install --quiet -r requirements-validation.txt
fi

echo "Ambiente pronto. Para usar o Node 24 neste shell: export PATH=\"$NODE_DIR/bin:\$PATH\""
echo "Para npm run test:containers: export MEUREMEDIO_BASE_IMAGE=mirror.gcr.io/library/node:$BASE_TAG@$BASE_DIGEST MEUREMEDIO_BUILD_CA=/root/.ccr/ca-bundle.crt"
