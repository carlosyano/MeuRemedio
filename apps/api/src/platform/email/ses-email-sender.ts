// Adaptador SES (API v2) da porta EmailSender (OA-004, DC-069). O aceite do SES e o aceite tecnico
// do RN-014 (nao entrega nem leitura). Falha do cliente (4xx, inclusive limite de envio) e recusa
// definitiva: a mensagem com certeza nao foi aceita. Falha do servidor, rede ou timeout deixam o
// envio incerto (DEC-005). Os erros devolvidos levam so o nome do erro do SES: o texto do
// provedor pode citar o endereco do destinatario e nunca vai para logs.
import {
  SendEmailCommand,
  type SendEmailCommandOutput,
  SESv2Client,
  SESv2ServiceException,
} from '@aws-sdk/client-sesv2';
import {
  type EmailMessage,
  type EmailReceipt,
  EmailRejectedError,
  type EmailSender,
  unconfiguredEmailSender,
} from './email-sender.js';

/** O que o adaptador usa do SESv2Client (o teste troca por um duble). */
export interface SesCommands {
  send(command: SendEmailCommand): Promise<SendEmailCommandOutput>;
}

export interface SesEmailSenderOptions {
  readonly client: SesCommands;
  /** Remetente verificado no SES (EMAIL_FROM). */
  readonly from: string;
  /** Configuration set que publica os eventos de entrega para a conciliacao (DEC-005). */
  readonly configurationSet?: string;
}

const UTF8 = 'UTF-8';

/**
 * Erro do envio sem o erro original (nem como cause): o texto do provedor pode citar o endereco.
 * Falha do cliente vira recusa definitiva; o resto, envio incerto.
 */
const sanitized = (error: unknown): Error => {
  if (error instanceof SESv2ServiceException && error.$fault === 'client') {
    return new EmailRejectedError(`SES recusou a mensagem (${error.name})`);
  }
  const name = error instanceof Error ? error.name : 'desconhecido';
  return new Error(`Envio incerto pelo SES (${name})`);
};

export class SesEmailSender implements EmailSender {
  private readonly client: SesCommands;
  private readonly from: string;
  private readonly configurationSet: string | undefined;

  constructor(options: SesEmailSenderOptions) {
    this.client = options.client;
    this.from = options.from;
    this.configurationSet = options.configurationSet;
  }

  async send(message: EmailMessage): Promise<EmailReceipt | undefined> {
    let output: SendEmailCommandOutput;
    try {
      output = await this.client.send(
        new SendEmailCommand({
          FromEmailAddress: this.from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: UTF8 },
              Body: { Text: { Data: message.text, Charset: UTF8 } },
            },
          },
          ...(message.reference === undefined
            ? {}
            : { EmailTags: [{ Name: 'reference', Value: message.reference }] }),
          ...(this.configurationSet === undefined
            ? {}
            : { ConfigurationSetName: this.configurationSet }),
        }),
      );
    } catch (error) {
      throw sanitized(error);
    }
    return output.MessageId === undefined ? undefined : { providerMessageId: output.MessageId };
  }
}

const valueOf = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
};

/**
 * Provedor de e-mail pelo ambiente: EMAIL_PROVIDER=ses com EMAIL_FROM obrigatorio e
 * EMAIL_CONFIGURATION_SET opcional (regiao e credenciais pela cadeia padrao da AWS, ou seja, o
 * papel da tarefa no ECS). Sem EMAIL_PROVIDER, o envio fica sem provedor (recusa definitiva).
 */
export const emailSenderFromEnv = (env: NodeJS.ProcessEnv): EmailSender => {
  const provider = valueOf(env, 'EMAIL_PROVIDER');
  if (provider === undefined) return unconfiguredEmailSender;
  if (provider !== 'ses') throw new Error('EMAIL_PROVIDER desconhecido (aceito: ses)');
  const from = valueOf(env, 'EMAIL_FROM');
  if (from === undefined) throw new Error('EMAIL_FROM nao definida (EMAIL_PROVIDER=ses)');
  const configurationSet = valueOf(env, 'EMAIL_CONFIGURATION_SET');
  const region = valueOf(env, 'AWS_REGION');
  return new SesEmailSender({
    client: new SESv2Client(region === undefined ? {} : { region }),
    from,
    ...(configurationSet === undefined ? {} : { configurationSet }),
  });
};
