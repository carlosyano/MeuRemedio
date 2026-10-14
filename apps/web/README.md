# apps/web

Aplicação web do MeuRemedio (ADR-001 v1.5: Next.js, React e TypeScript strict; Tailwind CSS).

- O navegador fala só com a origem da aplicação: `/api/*` é encaminhado à API (`MEUREMEDIO_API_URL`, lida no build). Os cookies `mr_session` e `mr_csrf` ficam nessa origem, e o `Origin` das mutações é o da aplicação (OA-008). A API precisa listar essa origem em `ALLOWED_ORIGINS`.
- `src/lib/api-client.ts`: cliente da API (CSRF, `Idempotency-Key`, Problem, indisponibilidade sem fila offline) e mensagens do catálogo de erros da Especificação.
- Estilo neutro provisório; a identidade visual entra com o design system (DC-052).

```bash
MEUREMEDIO_API_URL=http://127.0.0.1:3000 npm run dev -w @meuremedio/web
npm run test:e2e   # Playwright + axe contra PostgreSQL, API e web reais (exige Docker)
```
