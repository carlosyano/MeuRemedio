// Tipos de coluna compartilhados pelos schemas Drizzle dos modulos.
import { customType } from 'drizzle-orm/pg-core';

/** bytea <-> Buffer (o node-postgres ja entrega Buffer na leitura). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Objeto JSON armazenado em jsonb. */
export type JsonObject = Record<string, unknown>;
