// Marca o handler com o operationId da OpenAPI; a aplicacao nao sobe sem ele (route-check.ts).
import { SetMetadata } from '@nestjs/common';

export const OPERATION_ID = 'meuremedio:operationId';

export const OperationId = (operationId: string): MethodDecorator =>
  SetMetadata(OPERATION_ID, operationId);
