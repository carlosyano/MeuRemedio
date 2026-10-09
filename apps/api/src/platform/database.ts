// Porta minima de acesso ao PostgreSQL usada pela borda HTTP (pg.Pool a satisfaz).

export interface Queryable {
  query(text: string): Promise<{ rows: unknown[] }>;
}

export const DATABASE = Symbol('Database');
