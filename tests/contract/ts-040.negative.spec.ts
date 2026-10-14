// @trace TS-040 (testes dos testes): cada regra precisa REPROVAR um contrato deliberadamente quebrado.
import { describe, expect, it } from 'vitest';
import { asArray, asString, asStrings, dig, type JsonObject } from './support/json.js';
import { loadContract, type ContractContext } from './support/load.js';
import { RULES, type Allowance } from './support/rules.js';

const base = loadContract();

function paths(ctx: ContractContext, path: string, method: string): JsonObject {
  return dig(ctx.api, 'paths', path, method);
}

function without(object: JsonObject, key: string): void {
  Reflect.deleteProperty(object, key);
}

const MUTATIONS: Readonly<Record<string, (ctx: ContractContext) => void>> = {
  R01: (c) => {
    dig(c.matrix, 'operations')['ghostOperation'] = { method: 'GET', path: '/ghost' };
  },
  R02: (c) => {
    dig(c.api, 'components', 'responses', 'Unauthorized')['x-quebrado'] = {
      $ref: '#/components/schemas/Inexistente',
    };
  },
  R03: (c) => {
    asArray(
      dig(c.api, 'components', 'schemas', 'Problem', 'properties', 'code')['enum'],
      'enum',
    ).pop();
  },
  R04: (c) => {
    without(dig(paths(c, '/sessions', 'post'), 'responses'), '409');
  },
  R05: (c) => {
    dig(c.matrix, 'errors', 'ERR-013')['operationIds'] = [];
  },
  R06: (c) => {
    asArray(dig(c.matrix, 'operations', 'createSession')['response_statuses'], 'statuses').push(
      '999',
    );
  },
  R07: (c) => {
    without(dig(paths(c, '/plans', 'get'), 'responses'), '429');
  },
  R08: (c) => {
    paths(c, '/plans', 'post')['parameters'] = asArray(
      paths(c, '/plans', 'post')['parameters'],
      'p',
    ).filter((p) => !JSON.stringify(p).includes('IdempotencyKey'));
  },
  R09: (c) => {
    paths(c, '/plans/{plan_id}', 'delete')['security'] = [{ sessionCookie: [] }];
  },
  R10: (c) => {
    without(dig(paths(c, '/plans/{plan_id}', 'get'), 'responses'), '404');
  },
  R11: (c) => {
    const r = dig(c.api, 'components', 'responses', 'Unauthorized');
    r['content'] = { 'application/json': {} };
  },
  R12: (c) => {
    without(dig(paths(c, '/plans', 'post'), 'responses', '201', 'headers'), 'X-Correlation-ID');
  },
  R13: (c) => {
    without(dig(paths(c, '/plans/{plan_id}', 'get'), 'responses', '200', 'headers'), 'ETag');
  },
  R14: (c) => {
    const s = dig(c.api, 'components', 'securitySchemes', 'sessionCookie');
    s['description'] = asString(s['description'], 'descricao').replace('HttpOnly', '');
  },
  R15: (c) => {
    asArray(paths(c, '/plans', 'post')['x-traceability'], 'x').push('TS-999');
  },
  R16: (c) => {
    Object.assign(c, { openapiSha256: '0'.repeat(64) });
  },
  R18: (c) => {
    without(dig(paths(c, '/plans', 'get'), 'responses'), '500');
  },
  R19: (c) => {
    without(dig(paths(c, '/plans', 'post'), 'responses'), '400');
  },
  R17: () => undefined, // usa EXTRA_ALLOWANCES (excecao sintetica sem lacuna na matriz)
};

const EXTRA_ALLOWANCES: Readonly<Record<string, readonly Allowance[]>> = {
  R17: [
    { rule: 'R05', key: 'opSintetica:410', gap: 'GAP-404', reason: 'excecao sintetica sem lacuna' },
  ],
};

describe('TS-040 testes negativos: toda regra detecta um contrato quebrado', () => {
  it('existe uma mutacao para cada regra', () => {
    expect(Object.keys(MUTATIONS).sort()).toEqual(RULES.map((r) => r.id).sort());
  });

  it.each(RULES.map((rule) => [rule.id, rule.title, rule] as const))(
    '%s reprova a mutacao correspondente',
    (id, _title, rule) => {
      const mutate = MUTATIONS[id];
      if (!mutate) throw new Error(`sem mutacao para ${id}`);
      const before = rule.check(base).length;
      const broken: ContractContext = structuredClone(base);
      mutate(broken);
      const after = rule.check(broken, EXTRA_ALLOWANCES[id]);
      expect(
        after.length,
        `${id}: violacoes antes=${String(before)} depois=${String(after.length)}`,
      ).toBeGreaterThan(before);
    },
  );

  it('as mutacoes nao alteram o contrato original em memoria', () => {
    expect(RULES.map((r) => r.id).every((id) => id in MUTATIONS)).toBe(true);
    expect(
      asStrings(
        asArray(
          dig(base.api, 'components', 'schemas', 'Problem', 'properties', 'code')['enum'],
          'enum',
        ),
        'enum',
      ).length,
    ).toBeGreaterThan(10);
  });
});
