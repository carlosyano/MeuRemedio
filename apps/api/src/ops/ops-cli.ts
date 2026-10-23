// Scripts operacionais versionados (docs/operations/RIGHTS_AND_INCIDENTS.md §1; DEC-022, DC-066,
// DC-067): acesso por papel IAM, fora da API HTTP, com auditoria. Saida em uma linha JSON; erros
// sem ecoar valores recebidos, porque podem conter dado do titular (TS-030, TS-032).
// Codigos de saida: 0 sucesso; 2 uso invalido; 3 recusa do procedimento.
import { IncidentRejected } from '../modules/audit/application/incidents.js';
import { RightsRequestRejected } from '../modules/privacy/application/rights-requests.js';
import { UsageError, type OpsCommand, type OpsIo } from './args.js';
import { INCIDENT_COMMANDS, INCIDENT_USAGE } from './incident-commands.js';
import { RIGHTS_COMMANDS, RIGHTS_USAGE } from './rights-commands.js';

export type { OpsIo } from './args.js';

const USAGE = ['uso:', ...RIGHTS_USAGE, ...INCIDENT_USAGE].join('\n');

const COMMANDS: Readonly<Record<string, OpsCommand>> = {
  ...RIGHTS_COMMANDS,
  ...INCIDENT_COMMANDS,
};

const isParseArgsError = (error: unknown): error is TypeError & { code: string } =>
  error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS');

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
    if (isParseArgsError(error)) {
      io.err(`opcao invalida (${error.code})\n${USAGE}`);
      return 2;
    }
    if (error instanceof RightsRequestRejected || error instanceof IncidentRejected) {
      io.err(error.message);
      return 3;
    }
    throw error;
  }
}
