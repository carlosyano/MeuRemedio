# Ambiente local (sem AWS)

Sobe a aplicação inteira na sua máquina com Docker: banco, migração, API, worker, web e uma caixa de e-mail local (Mailpit). Nada sai da máquina e nenhuma conta de nuvem é necessária (DC-073).

## Requisitos

- Docker Desktop em execução (no Windows, com o WSL 2 habilitado).
- Node.js 24 e o repositório atualizado (`git pull`).

## Primeira vez

No terminal (PowerShell ou Git Bash), na pasta do repositório:

```bash
npm run local:env
docker compose up --build
```

O primeiro `up` constrói as imagens e leva alguns minutos. Quando aparecer `web-1  | ✓ Ready`, abra:

- **Aplicação:** http://localhost:3001
- **E-mails enviados** (confirmação de cadastro, redefinição de senha, lembretes): http://localhost:8025

Use `localhost`, não `127.0.0.1`: o cookie de sessão é `Secure`, e os navegadores só o aceitam em http no endereço `localhost`.

## Fluxo para testar

1. Em http://localhost:3001, clique em **Criar conta** e cadastre-se com um e-mail qualquer (ex.: `ana.silva@example.com`). Nenhum e-mail sai de verdade.
2. Abra http://localhost:8025, abra a mensagem **Confirme seu e-mail no MeuRemedio** e clique no link.
3. Entre com o e-mail e a senha. Você chega em **Hoje**.
4. Em **Planos**, crie um plano com horários. As ocorrências aparecem em **Hoje**. Os lembretes por e-mail também caem no Mailpit.

## Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `docker compose up -d --build` | Sobe em segundo plano, reconstruindo depois de um `git pull` |
| `docker compose logs -f api worker` | Acompanha os logs |
| `docker compose down` | Para tudo e mantém os dados |
| `docker compose down -v` | Para tudo e **apaga** banco, exportações e e-mails |

## Se o build falhar

- **`frontend grpc server closed unexpectedly`** ou o build parado por minutos: o Docker Desktop ficou sem memória. Reinicie o Docker Desktop e construa uma imagem por vez: `docker compose build migrate`, `docker compose build web` e depois `docker compose up`. Se voltar a acontecer, aumente a memória do WSL 2 (arquivo `%UserProfile%\.wslconfig`, por exemplo `memory=6GB`) e reinicie o WSL com `wsl --shutdown`.
- **`Cannot find module '@next/swc-linux-...'`** no build da web: o download do compilador do Next falhou. Rode o build de novo.
- Não rode `npm install <pacote>` para corrigir erro de build: isso altera o `package-lock.json`. Desfaça com `git checkout package.json package-lock.json`.

## Limites

- Só para teste na própria máquina: as portas escutam apenas em `127.0.0.1`, e a senha do banco é fixa no `compose.yaml`.
- O `.env` criado pelo `npm run local:env` guarda os segredos desta máquina. Ele não entra no git; não o copie para outro ambiente.
- Não use dados reais de saúde: os pareceres GX-001 a GX-006 continuam pendentes.
- Não prova o que só existe na AWS (TLS do banco, IAM, SES, S3). Isso fica para a homologação (`infra/terraform/README.md`).
