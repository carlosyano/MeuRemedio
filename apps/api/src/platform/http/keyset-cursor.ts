// Cursor opaco de paginacao por chave (DC-030): base64url do JSON { t, i } com o instante e o id
// do ultimo item entregue. Cursor fora do formato -> 400 VALIDATION_FAILED no campo cursor.
import { ProblemError } from './problem-catalog.js';

export const DEFAULT_PAGE_LIMIT = 20;

export interface KeysetCursor {
  /** Instante UTC da ordenacao do ultimo item (RFC 3339, com ou sem fracao). */
  readonly t: string;
  /** id do ultimo item entregue. */
  readonly i: string;
}

export interface PageMeta {
  readonly next_cursor: string | null;
  readonly limit: number;
}

const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const encodeCursor = (cursor: KeysetCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

export function decodeCursor(value: string): KeysetCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      't' in parsed &&
      'i' in parsed &&
      typeof parsed.t === 'string' &&
      typeof parsed.i === 'string' &&
      CURSOR_INSTANT.test(parsed.t) &&
      UUID.test(parsed.i)
    ) {
      return { t: parsed.t, i: parsed.i };
    }
  } catch {
    // cai no erro abaixo
  }
  throw new ProblemError('VALIDATION_FAILED', [
    { field: 'cursor', code: 'INVALID', message: 'Valor inválido.' },
  ]);
}

/**
 * Pagina a partir de limit + 1 linhas: o item excedente so indica que ha proxima pagina, e o
 * cursor aponta para o ultimo item entregue.
 */
export function pageOf<Row, Item>(
  rows: readonly Row[],
  limit: number,
  toItem: (row: Row) => Item,
  cursorOf: (row: Row) => KeysetCursor,
): { items: Item[]; page: PageMeta } {
  const delivered = rows.slice(0, limit);
  const last = delivered[delivered.length - 1];
  return {
    items: delivered.map(toItem),
    page: {
      next_cursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
      limit,
    },
  };
}
