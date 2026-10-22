// Falha de dependencia do PostgreSQL (ERR-011, DC-062): conexao recusada, perdida ou sem resposta
// dentro do tempo-limite do pool, ou servidor recusando conexoes (desligamento, inicializacao,
// limite de conexoes). Vira 503 DEPENDENCY_UNAVAILABLE; qualquer outra falha segue 500
// INTERNAL_ERROR (DEC-026).

/** Erros de rede do Node.js na conexao com o banco. */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

/** SQLSTATE fora da classe 08 (connection exception) que indicam servidor indisponivel. */
const UNAVAILABLE_SQLSTATES = new Set(['57P01', '57P02', '57P03', '53300']);

/** Mensagens do pg e do pg-pool para conexao perdida ou tempo-limite de conexao. */
const CONNECTION_MESSAGES = [
  /^timeout exceeded when trying to connect$/,
  /^Connection terminated/,
  /^Client has encountered a connection error/,
];

export function isDependencyUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code: unknown = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    if (NETWORK_CODES.has(code) || UNAVAILABLE_SQLSTATES.has(code)) return true;
    if (/^08[0-9A-Z]{3}$/.test(code)) return true;
  }
  if (CONNECTION_MESSAGES.some((pattern) => pattern.test(error.message))) return true;
  if (error instanceof AggregateError && error.errors.some(isDependencyUnavailable)) return true;
  return isDependencyUnavailable(error.cause);
}
