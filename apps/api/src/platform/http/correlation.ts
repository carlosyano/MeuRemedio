// X-Correlation-ID: um UUID novo por requisicao, presente em toda resposta (OpenAPI 02.33.9,
// info.description) e repetido em Problem.correlation_id. O servidor nao aceita valor do cliente.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const CORRELATION_HEADER = 'x-correlation-id';

const ids = new WeakMap<IncomingMessage, string>();

export function assignCorrelationId(raw: IncomingMessage): string {
  const id = randomUUID();
  ids.set(raw, id);
  return id;
}

export function correlationIdOf(raw: IncomingMessage): string {
  const id = ids.get(raw);
  if (id === undefined) throw new Error('Requisicao sem X-Correlation-ID atribuido');
  return id;
}

/** Caminho da requisicao sem a consulta (Problem.instance). */
export const instanceOf = (url: string): string => url.split('?')[0] ?? url;
