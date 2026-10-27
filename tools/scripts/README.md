# tools/scripts

Scripts operacionais versionados.

| Script | Uso |
|---|---|
| `openapi-lint.mjs` | `npm run openapi:lint`: Spectral (ruleset `oas`) na OpenAPI normativa (QG-001) |
| `openapi-diff.mjs` | `npm run openapi:diff [base] [revisao]`: oasdiff `breaking` contra a base (arquivo ou ref git; padrão: merge-base com `origin/main` ou `OPENAPI_DIFF_BASE`). Incompatibilidades aprovadas em `tools/oasdiff/approved-breaking.txt` |
| `oasdiff-bin.mjs` | Download do binário fixado do oasdiff com verificação de SHA-256 (usado pelo `openapi-diff.mjs`) |
| `sbom.mjs` | `npm run sbom`: SBOM CycloneDX das dependências de produção em `sbom/sbom.cdx.json` e verificação da política de licenças (QG-006) |
| `license-policy.mjs` | Política de licenças (permissivas; exceções revisadas por versão), usada pelo `sbom.mjs` (DC-048) |
| `sarif-gate.mjs` | `node tools/scripts/sarif-gate.mjs <dir>`: reprova SARIF do CodeQL com achado de `security-severity` >= 7.0 (QG-005, DC-049) |
| `trace-check.mjs` | `npm run trace:check`: rastreabilidade dos testes (`// @trace` com IDs da matriz ou operationIds, toda operação com teste, RF e TS sem teste só quando planejados) (QG-011, DC-060) |
| `cloud-setup.sh` | `bash tools/scripts/cloud-setup.sh`: prepara o container da nuvem do Claude Code (Node 24 com SHA-256 conferido, `dockerd`, imagem `postgres:17` com fallback para `mirror.gcr.io` e `npm ci`) e indica as variáveis do `test:containers` (espelho da imagem base e CA do proxy). Idempotente; pode virar hook SessionStart |
