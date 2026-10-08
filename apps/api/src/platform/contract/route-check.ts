// Rotas declaradas pela aplicacao x OpenAPI normativa (ADR-001 v1.5 secao 7, "Contrato"):
// toda rota precisa de operationId e corresponder exatamente a metodo e caminho do contrato.
// A aplicacao nao sobe se houver divergencia.
import { toRoutePath, type OpenApiContract } from './openapi-contract.js';

export interface DeclaredRoute {
  readonly method: string;
  /** Caminho no formato do Fastify/NestJS, ex.: /plans/:plan_id. */
  readonly path: string;
  readonly operationId: string | undefined;
  /** Identificacao do handler para a mensagem de erro (Controller.metodo). */
  readonly handler: string;
}

export class ContractMismatchError extends Error {
  public override readonly name = 'ContractMismatchError';

  constructor(public readonly problems: readonly string[]) {
    super(`Rotas divergentes da OpenAPI normativa:\n- ${problems.join('\n- ')}`);
  }
}

export function assertRoutesMatchContract(
  routes: readonly DeclaredRoute[],
  contract: OpenApiContract,
): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    const where = `${route.handler} (${route.method} ${route.path})`;
    if (route.operationId === undefined) {
      problems.push(`${where}: sem operationId`);
      continue;
    }
    const operation = contract.operations.find((op) => op.operationId === route.operationId);
    if (operation === undefined) {
      problems.push(`${where}: operationId ${route.operationId} fora do contrato`);
      continue;
    }
    if (
      operation.method !== route.method.toUpperCase() ||
      toRoutePath(operation.path) !== route.path
    ) {
      problems.push(
        `${where}: ${route.operationId} e ${operation.method} ${toRoutePath(operation.path)} no contrato`,
      );
    }
    if (seen.has(route.operationId)) problems.push(`${where}: ${route.operationId} repetido`);
    seen.add(route.operationId);
  }
  if (problems.length > 0) throw new ContractMismatchError(problems);
}
