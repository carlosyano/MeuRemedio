// @trace TS-040 RNF-014 RNF-016 RNF-006 (Especificacao 02.33 secao 13; AGENTS.md secoes 13 e 14)
// Escopo deste arquivo: verificacoes ESTATICAS do contrato (OpenAPI x matriz). Com a API em execucao:
// rotas x OpenAPI em tests/integration/routes.spec.ts; Set-Cookie real de createSession em
// tests/integration/sessions.spec.ts; oasdiff em openapi-diff.spec.ts; Schemathesis em
// tests/schemathesis/ts-040.schemathesis.spec.ts.
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
