// @trace TS-040 RNF-014 RNF-016 RNF-006 (Especificacao 02.33 secao 13; AGENTS.md secoes 13 e 14)
// Escopo desta etapa: verificacoes ESTATICAS do contrato (OpenAPI x matriz). Pendentes e dependentes de
// API em execucao: rotas da aplicacao x OpenAPI, Schemathesis, Set-Cookie real (oasdiff: openapi-diff.spec.ts).
import { describe, expect, it } from 'vitest';
import { loadContract } from './support/load.js';
import { RULES } from './support/rules.js';

const ctx = loadContract();

describe('TS-040 contrato: OpenAPI x matriz de rastreabilidade', () => {
  it.each(RULES.map((rule) => [rule.id, rule.title, rule] as const))(
    '%s %s',
    (_id, _title, rule) => {
      expect(rule.check(ctx)).toEqual([]);
    },
  );
});

describe('TS-040 pendencias conhecidas (fora desta etapa)', () => {
  it.todo(
    'rotas da aplicacao em execucao sao identicas a OpenAPI e nao ha rota extra (requer a API)',
  );
  it.todo(
    'Schemathesis sem falhas nas 27 operacoes e todo status retornado esta documentado (requer a API)',
  );
  it.todo('createSession emite mr_session e mr_csrf com os atributos documentados (requer a API)');
});
