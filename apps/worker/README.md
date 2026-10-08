# apps/worker

Reservado pela estrutura de referencia do AGENTS.md (secao 6.1).

O processo do worker roda hoje a partir da mesma base de codigo da API (DC-022 em
`docs/decisions/DECISOES_CLAUDE.md`): `apps/api/src/worker.ts` (`startWorker`) e o ponto de entrada
`apps/api/src/worker-main.ts`, com implantacao propria, separada da API (AGENTS.md §6). Este
diretorio recebe o processo se ele passar a ter dependencias proprias.
