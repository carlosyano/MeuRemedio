# Migracoes SQL

Migracoes explicitas (ADR-001 v1.5, OA-001), aplicadas em ordem por `src/platform/migrate.ts`.
Nome: `NNNN_descricao.sql`. Uma migracao aplicada nunca deve ser editada (o checksum e verificado);
mudancas entram em uma nova migracao. Modelo de referencia: `docs/architecture/DATA_MODEL.md`.
