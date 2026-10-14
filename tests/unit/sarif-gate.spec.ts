// @trace RNF-014 (AGENTS.md QG-005: achado critico ou alto sem excecao formal reprova)
// Gate do CodeQL sobre o SARIF (DC-049): reprova resultado cuja regra tem security-severity >= 7.0
// (alta ou critica, na escala CVSS do CodeQL); medio e baixo so aparecem no relatorio.
import { describe, expect, it } from 'vitest';
import { blockingFindings } from '../../tools/scripts/sarif-gate.mjs';

const sarif = (severity: string | undefined) => ({
  runs: [
    {
      tool: {
        driver: {
          rules: [
            {
              id: 'js/sql-injection',
              properties: severity === undefined ? {} : { 'security-severity': severity },
            },
          ],
        },
      },
      results: [
        {
          ruleId: 'js/sql-injection',
          message: { text: 'Consulta montada com dado do usuario.' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'apps/api/src/x.ts' },
                region: { startLine: 10 },
              },
            },
          ],
        },
      ],
    },
  ],
});

describe('gate do CodeQL (QG-005)', () => {
  it.each(['9.8', '7.0'])('reprova security-severity %s', (severity) => {
    expect(blockingFindings(sarif(severity))).toEqual([
      'js/sql-injection (security-severity ' +
        severity +
        ') em apps/api/src/x.ts:10: Consulta montada com dado do usuario.',
    ]);
  });

  it.each(['6.9', '4.0'])('nao reprova security-severity %s', (severity) => {
    expect(blockingFindings(sarif(severity))).toEqual([]);
  });

  it('regra sem security-severity (qualidade) nao reprova', () => {
    expect(blockingFindings(sarif(undefined))).toEqual([]);
  });

  it('SARIF sem resultados nao reprova', () => {
    expect(blockingFindings({ runs: [{ tool: { driver: { rules: [] } }, results: [] }] })).toEqual(
      [],
    );
  });
});
