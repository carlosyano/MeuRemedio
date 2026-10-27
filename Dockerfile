# syntax=docker/dockerfile:1
# Imagens da API (com o worker e a migracao) e da web (DC-070). Build pela raiz do repositorio:
#   docker build --target api -t meuremedio-api .
#   docker build --target web --build-arg MEUREMEDIO_API_URL=http://api.interno:3000 -t meuremedio-web .
# Imagem base fixada por digest; BASE_IMAGE permite um espelho com o mesmo digest. Atras de um
# proxy com CA propria, o segredo opcional npm_ca (--secret id=npm_ca,src=<pem>) entra so no npm ci.
ARG BASE_IMAGE=node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

FROM ${BASE_IMAGE} AS base
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# Manifestos primeiro, para o cache das dependencias sobreviver a mudancas de codigo.
FROM base AS manifests
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
COPY packages/domain/package.json packages/domain/
COPY packages/shared/package.json packages/shared/
COPY packages/testkit/package.json packages/testkit/

# Dependencias completas para compilar; --ignore-scripts: nenhum script de instalacao de terceiros
# roda no build (os binarios do argon2 vem como pacotes opcionais pre-compilados).
FROM manifests AS build-deps
RUN --mount=type=secret,id=npm_ca,required=false \
    NODE_EXTRA_CA_CERTS=$(test -f /run/secrets/npm_ca && echo /run/secrets/npm_ca) \
    npm ci --include=dev --ignore-scripts --no-audit

FROM build-deps AS api-build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps/api apps/api
RUN npx tsc -b apps/api

FROM build-deps AS web-build
ARG MEUREMEDIO_API_URL
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN test -n "$MEUREMEDIO_API_URL" && npx next build apps/web

# Dependencias de producao de cada aplicacao, sem as de desenvolvimento.
FROM manifests AS api-deps
RUN --mount=type=secret,id=npm_ca,required=false \
    NODE_EXTRA_CA_CERTS=$(test -f /run/secrets/npm_ca && echo /run/secrets/npm_ca) \
    npm ci --omit=dev --ignore-scripts --no-audit -w @meuremedio/api -w @meuremedio/domain \
    && mkdir -p apps/api/node_modules

FROM manifests AS web-deps
RUN --mount=type=secret,id=npm_ca,required=false \
    NODE_EXTRA_CA_CERTS=$(test -f /run/secrets/npm_ca && echo /run/secrets/npm_ca) \
    npm ci --omit=dev --ignore-scripts --no-audit -w @meuremedio/web \
    && mkdir -p apps/web/node_modules

# API: `node apps/api/dist/main.js` (padrao); worker: `node apps/api/dist/worker-main.js`;
# migracao: `node apps/api/dist/migrate-main.js`; operacao: `node apps/api/dist/ops-main.js`.
# A disposicao repete a do repositorio: o contrato e lido da OpenAPI na raiz.
FROM base AS api
COPY --from=api-deps /app/node_modules node_modules
COPY --from=api-deps /app/package.json package.json
# dependencias que o npm nao pode elevar para a raiz (conflito de versao)
COPY --from=api-deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=api-build /app/packages/domain/package.json packages/domain/package.json
COPY --from=api-build /app/packages/domain/dist packages/domain/dist
COPY --from=api-build /app/apps/api/package.json apps/api/package.json
COPY --from=api-build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
COPY apps/api/assets apps/api/assets
COPY MeuRemedio_OpenAPI_*_COMPLETO.yaml ./
# Exportacoes em disco no ambiente local (EXPORT_STORAGE_DIR, DC-073): o volume montado aqui
# herda o dono node na criacao. Na AWS as exportacoes vao para o S3 e o diretorio fica vazio.
RUN mkdir -p /var/lib/meuremedio/exports && chown node:node /var/lib/meuremedio/exports
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

# Web: next start na porta 3001. MEUREMEDIO_API_URL e lida no build (rewrites) e na subida.
FROM base AS web
COPY --from=web-deps /app/node_modules node_modules
COPY --from=web-deps /app/package.json package.json
COPY --from=web-deps /app/apps/web/node_modules apps/web/node_modules
COPY --from=web-build /app/apps/web/package.json apps/web/package.json
COPY --from=web-build /app/apps/web/next.config.ts apps/web/next.config.ts
COPY --from=web-build /app/apps/web/.next apps/web/.next
USER node
EXPOSE 3001
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3001"]
