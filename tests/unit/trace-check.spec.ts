// @trace RNF-014 QG-011
// Gate de rastreabilidade dos testes (AGENTS.md QG-011; DC-060): todo arquivo de teste comeca com
// "// @trace" e IDs que existem na matriz ou operationIds do contrato (o que vem depois do primeiro
// "(" e comentario livre); a isencao exige "// @trace-exempt <motivo>"; toda operacao tem teste;
// requisito ou teste sentinela sem teste reprova, salvo quando a matriz o marca como planejado.
import { describe, expect, it } from 'vitest';
import { checkTraceability, type TraceInput } from '../../tools/scripts/trace-check.mjs';

const base = (files: TraceInput['files']): TraceInput => ({
  ids: new Set(['RF-001', 'RF-002', 'TS-001', 'TS-002', 'ERR-001']),
  operations: new Set(['createAccount', 'getHealth']),
  requirements: { 'RF-001': ['TS-001'], 'RF-002': ['TS-002'] },
  sentinelTests: { 'TS-001': ['implemented'], 'TS-002': ['planned'] },
  files,
});

const ok = {
  path: 'tests/unit/a.spec.ts',
  content: '// @trace RF-001 TS-001 createAccount getHealth\nimport x;\n',
};

describe('checkTraceability', () => {
  it('arquivos rastreados, operacoes cobertas: sem erros; planejado vira pendencia', () => {
    const result = checkTraceability(base([ok]));
    expect(result.errors).toEqual([]);
    expect(result.pending).toEqual([
      'RF-002 sem teste (planejado: TS-002)',
      'TS-002 sem teste (planejado)',
    ]);
  });

  it('arquivo sem @trace na primeira linha reprova', () => {
    const result = checkTraceability(
      base([
        ok,
        { path: 'tests/unit/b.spec.ts', content: '// Teste qualquer\n// @trace RF-001\n' },
      ]),
    );
    expect(result.errors).toEqual(['tests/unit/b.spec.ts: primeira linha sem // @trace']);
  });

  it('isencao explicita exige motivo', () => {
    const exempt = (content: string) =>
      checkTraceability(base([ok, { path: 'tests/unit/c.spec.ts', content }])).errors;
    expect(exempt('// @trace-exempt infraestrutura de testes, sem ID normativo\n')).toEqual([]);
    expect(exempt('// @trace-exempt\n')).toEqual([
      'tests/unit/c.spec.ts: @trace-exempt sem motivo',
    ]);
  });

  it('identificador inexistente reprova; o texto depois do primeiro "(" e livre', () => {
    const result = checkTraceability(
      base([
        {
          ...ok,
          content: '// @trace RF-001 TS-001 createAccount getHealth RF-999 (RF-777 livre)\n',
        },
      ]),
    );
    expect(result.errors).toEqual(['tests/unit/a.spec.ts: identificador inexistente RF-999']);
  });

  it('@trace sem nenhum ID reprova', () => {
    const result = checkTraceability(
      base([ok, { path: 'tests/unit/d.spec.ts', content: '// @trace (so comentario)\n' }]),
    );
    expect(result.errors).toEqual(['tests/unit/d.spec.ts: @trace sem identificadores']);
  });

  it('operacao sem teste reprova', () => {
    const result = checkTraceability(
      base([{ ...ok, content: '// @trace RF-001 TS-001 createAccount\n' }]),
    );
    expect(result.errors).toEqual(['operacao getHealth sem teste']);
  });

  it('requisito ou teste sentinela sem teste e sem planejamento reprova', () => {
    const input = base([ok]);
    const result = checkTraceability({
      ...input,
      sentinelTests: { 'TS-001': ['implemented'], 'TS-002': ['implemented'] },
    });
    expect(result.errors).toEqual(['RF-002 sem teste', 'TS-002 sem teste']);
  });
});
