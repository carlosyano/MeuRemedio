// @trace ERR-011 ERR-016 DEC-026 (classificacao de falha do PostgreSQL, DC-062)
// Falha de conexao com o PostgreSQL e indisponibilidade (503 DEPENDENCY_UNAVAILABLE); qualquer
// outra falha segue inesperada (500 INTERNAL_ERROR).
import { describe, expect, it } from 'vitest';
import { isDependencyUnavailable } from '../../apps/api/src/platform/db/dependency-errors.js';

const withCode = (code: string, message = 'falha'): Error =>
  Object.assign(new Error(message), { code });

describe('isDependencyUnavailable (DC-062)', () => {
  it.each([
    ['conexao recusada', withCode('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:5432')],
    ['conexao reiniciada', withCode('ECONNRESET')],
    ['tempo de rede esgotado', withCode('ETIMEDOUT')],
    ['host inalcancavel', withCode('EHOSTUNREACH')],
    ['nome nao resolvido', withCode('ENOTFOUND')],
    ['resolucao temporaria', withCode('EAI_AGAIN')],
    [
      'varias tentativas recusadas',
      Object.assign(new AggregateError([withCode('ECONNREFUSED')], 'falha'), { code: undefined }),
    ],
    ['tempo-limite do pool', new Error('timeout exceeded when trying to connect')],
    ['conexao encerrada', new Error('Connection terminated unexpectedly')],
    ['tempo-limite da conexao', new Error('Connection terminated due to connection timeout')],
    ['SQLSTATE 08006 connection_failure', withCode('08006')],
    ['SQLSTATE 08001 cannot establish', withCode('08001')],
    ['SQLSTATE 57P01 admin_shutdown', withCode('57P01')],
    ['SQLSTATE 57P03 cannot_connect_now', withCode('57P03')],
    ['SQLSTATE 53300 too_many_connections', withCode('53300')],
    ['causa encadeada', new Error('falha', { cause: withCode('ECONNREFUSED') })],
  ])('%s: indisponivel', (_name, error) => {
    expect(isDependencyUnavailable(error)).toBe(true);
  });

  it.each([
    ['erro comum', new Error('boom')],
    ['violacao de unicidade', withCode('23505')],
    ['serializacao', withCode('40001')],
    ['sintaxe', withCode('42601')],
    ['valor que nao e erro', 'ECONNREFUSED'],
    ['indefinido', undefined],
  ])('%s: nao e indisponibilidade', (_name, error) => {
    expect(isDependencyUnavailable(error)).toBe(false);
  });
});
