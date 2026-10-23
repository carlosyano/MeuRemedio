// Scripts operacionais versionados (docs/operations/RIGHTS_AND_INCIDENTS.md §1; DEC-022, DC-066):
// acesso por papel IAM, fora da API HTTP, com auditoria. Saida em uma linha JSON; erros sem ecoar
// valores recebidos, porque podem conter dado do titular (TS-032). O e-mail da conta so entra pela
// entrada padrao, para nao ficar no historico do shell nem na lista de processos.
// Codigos de saida: 0 sucesso; 2 uso invalido; 3 recusa do procedimento.
import { parseArgs } from 'node:util';
import type { Pool } from 'pg';
import {
  advanceRightsRequest,
  registerRightsRequest,
  RIGHT_TYPES,
  RIGHTS_STATUSES,
  RightsRequestRejected,
  type RightType,
  type RightsStatus,
} from '../modules/privacy/application/rights-requests.js';
import type { Clock } from '../platform/clock.js';

export interface OpsIo {
  readonly pool: Pool;
  readonly clock: Clock;
  /** Principal IAM de quem executa (OPS_OPERATOR). */
  readonly operator: string;
  readonly readStdin: () => Promise<string>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = [
  'uso:',
  '  rights:register --channel <canal> --type <tipo> --received-at <RFC 3339> --due-at <RFC 3339> [--email-stdin]',
  '  rights:advance --protocol <DSR-AAAAMMDD-NNNN> --status <estado>',
  `  tipos: ${RIGHT_TYPES.join(', ')}; estados: ${RIGHTS_STATUSES.join(', ')}`,
].join('\n');

class UsageError extends Error {}

// Instante com fuso explicito.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROTOCOL = /^DSR-\d{8}-\d{4}$/;

function instant(name: string, value: string | undefined): string {
  if (value === undefined || !RFC3339.test(value) || Number.isNaN(Date.parse(value))) {
    throw new UsageError(`--${name} exige instante RFC 3339 com fuso`);
  }
  return new Date(value).toISOString();
}

function oneOf<T extends string>(name: string, value: string | undefined, values: readonly T[]): T {
  if (value === undefined || !(values as readonly string[]).includes(value)) {
    throw new UsageError(`--${name} fora do catalogo (${values.join(', ')})`);
  }
  return value as T;
}

async function register(args: string[], io: OpsIo): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      channel: { type: 'string' },
      type: { type: 'string' },
      'received-at': { type: 'string' },
      'due-at': { type: 'string' },
      'email-stdin': { type: 'boolean' },
    },
  });
  const channel = values.channel?.trim() ?? '';
  if (channel.length === 0 || channel.length > 40)
    throw new UsageError('--channel exige 1 a 40 caracteres');
  const rightType = oneOf<RightType>('type', values.type, RIGHT_TYPES);
  const receivedAt = instant('received-at', values['received-at']);
  const dueAt = instant('due-at', values['due-at']);
  if (Date.parse(dueAt) <= Date.parse(receivedAt)) {
    throw new UsageError('--due-at precisa ser posterior a --received-at');
  }
  let accountEmail: string | undefined;
  if (values['email-stdin'] === true) {
    const email = (await io.readStdin()).trim();
    if (!EMAIL.test(email)) throw new UsageError('e-mail da entrada padrao invalido');
    accountEmail = email;
  }
  const result = await registerRightsRequest(io, {
    channel,
    rightType,
    receivedAt,
    dueAt,
    ...(accountEmail === undefined ? {} : { accountEmail }),
  });
  io.out(
    JSON.stringify({
      protocol: result.protocol,
      status: result.status,
      account_linked: result.accountLinked,
    }),
  );
}

async function advance(args: string[], io: OpsIo): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { protocol: { type: 'string' }, status: { type: 'string' } },
  });
  const protocol = values.protocol ?? '';
  if (!PROTOCOL.test(protocol)) throw new UsageError('--protocol exige DSR-AAAAMMDD-NNNN');
  const status = oneOf<RightsStatus>('status', values.status, RIGHTS_STATUSES);
  io.out(JSON.stringify(await advanceRightsRequest(io, { protocol, status })));
}

const COMMANDS: Readonly<Record<string, (args: string[], io: OpsIo) => Promise<void>>> = {
  'rights:register': register,
  'rights:advance': advance,
};

export async function runOps(argv: readonly string[], io: OpsIo): Promise<number> {
  const [command, ...args] = argv;
  const handler = command === undefined ? undefined : COMMANDS[command];
  if (handler === undefined) {
    io.err(USAGE);
    return 2;
  }
  try {
    await handler(args, io);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n${USAGE}`);
      return 2;
    }
    // parseArgs cita a opcao desconhecida, nunca o valor (ex.: --email <e-mail> nao ecoa o e-mail).
    if (
      error instanceof TypeError &&
      'code' in error &&
      String(error.code).startsWith('ERR_PARSE_ARGS')
    ) {
      io.err(`opcao invalida (${String(error.code)})\n${USAGE}`);
      return 2;
    }
    if (error instanceof RightsRequestRejected) {
      io.err(error.message);
      return 3;
    }
    throw error;
  }
}
