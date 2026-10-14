// Testes de mutacao (AGENTS.md QG-010; DC-050). Escopo: o dominio puro (packages/domain), com o
// limite Foundation de 80% de Mutation Score; abaixo dele, o job reprova.
// Runner "command": o Stryker roda o Vitest uma vez por mutante e o ativa pela variavel
// __STRYKER_ACTIVE_MUTANT__. O @stryker-mutator/vitest-runner 10.0.0 nao ativa os mutantes com o
// Vitest 5 (todo mutante sobrevivia, inclusive os que os testes matam quando aplicados a mao).
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  // Node direto (sem npx): cada execucao custa segundos, e o tempo-limite precisa de folga para nao
  // contar mutante sobrevivente como timeout.
  commandRunner: {
    command: 'node node_modules/vitest/vitest.mjs run --bail 1 --config vitest.mutation.config.ts',
  },
  timeoutMS: 60_000,
  mutate: ['packages/domain/src/**/*.ts', '!packages/domain/src/index.ts'],
  coverageAnalysis: 'off',
  thresholds: { high: 90, low: 85, break: 80 },
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
