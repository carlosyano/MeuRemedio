// Comandos de solicitacao externa de direito (RF-011, TS-032, DC-066): rights:register e
// rights:advance. O e-mail da conta so entra pela entrada padrao, para nao ficar no historico do
// shell nem na lista de processos, e nao volta na saida.
import { parseArgs } from 'node:util';
import {
  advanceRightsRequest,
  registerRightsRequest,
  RIGHT_TYPES,
  RIGHTS_STATUSES,
  type RightType,
  type RightsStatus,
} from '../modules/privacy/application/rights-requests.js';
import { EMAIL, instant, oneOf, UsageError, type OpsCommand } from './args.js';

export const RIGHTS_USAGE = [
  '  rights:register --channel <canal> --type <tipo> --received-at <RFC 3339> --due-at <RFC 3339> [--email-stdin]',
  '  rights:advance --protocol <DSR-AAAAMMDD-NNNN> --status <estado>',
  `  tipos: ${RIGHT_TYPES.join(', ')}; estados: ${RIGHTS_STATUSES.join(', ')}`,
];

const PROTOCOL = /^DSR-\d{8}-\d{4}$/;

const register: OpsCommand = async (args, io) => {
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
  if (channel.length === 0 || channel.length > 40) {
    throw new UsageError('--channel exige 1 a 40 caracteres');
  }
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
};

const advance: OpsCommand = async (args, io) => {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { protocol: { type: 'string' }, status: { type: 'string' } },
  });
  const protocol = values.protocol ?? '';
  if (!PROTOCOL.test(protocol)) throw new UsageError('--protocol exige DSR-AAAAMMDD-NNNN');
  const status = oneOf<RightsStatus>('status', values.status, RIGHTS_STATUSES);
  io.out(JSON.stringify(await advanceRightsRequest(io, { protocol, status })));
};

export const RIGHTS_COMMANDS: Readonly<Record<string, OpsCommand>> = {
  'rights:register': register,
  'rights:advance': advance,
};
