// Adaptador Mailpit da porta EmailSender, so para o ambiente local (docker compose, DC-073): a
// mensagem vai para a caixa do Mailpit pela API HTTP (POST /api/v1/send) e nunca sai da maquina.
// Homologacao e producao usam o SES (DC-069). Mesma regra de erros do SES: 4xx e recusa
// definitiva, o resto fica incerto, e nenhum erro leva o destinatario nem o corpo da resposta.
import {
  type EmailMessage,
  type EmailReceipt,
  EmailRejectedError,
  type EmailSender,
} from './email-sender.js';

export interface MailpitEmailSenderOptions {
  /** Endereco do Mailpit (MAILPIT_URL), ex.: http://mailpit:8025. */
  readonly baseUrl: string;
  /** Remetente (EMAIL_FROM): `Nome <endereco>` ou so o endereco. */
  readonly from: string;
  /** O teste troca por um duble. */
  readonly fetch?: typeof globalThis.fetch;
}

const TIMEOUT_MS = 10_000;

interface Address {
  readonly Email: string;
  readonly Name?: string;
}

const addressOf = (value: string): Address => {
  const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(value);
  if (match === null) return { Email: value.trim() };
  const [, name = '', email = ''] = match;
  return name === '' ? { Email: email } : { Email: email, Name: name };
};

export class MailpitEmailSender implements EmailSender {
  private readonly endpoint: string;
  private readonly from: Address;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: MailpitEmailSenderOptions) {
    this.endpoint = new URL('api/v1/send', options.baseUrl.replace(/\/*$/, '/')).toString();
    this.from = addressOf(options.from);
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async send(message: EmailMessage): Promise<EmailReceipt | undefined> {
    const body = JSON.stringify({
      From: this.from,
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
      ...(message.reference === undefined ? {} : { Tags: [message.reference] }),
    });
    let response: Response;
    try {
      response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // So o nome do erro: a mensagem pode citar o endereco
      throw uncertain(error instanceof Error ? error.name : 'desconhecido');
    }
    if (response.status >= 400 && response.status < 500) {
      throw new EmailRejectedError(`Mailpit recusou a mensagem (HTTP ${String(response.status)})`);
    }
    if (!response.ok) throw uncertain(`HTTP ${String(response.status)}`);
    const id = await response
      .json()
      .then((json: unknown) => (json as { ID?: unknown } | null)?.ID)
      .catch(() => undefined);
    return typeof id === 'string' && id !== '' ? { providerMessageId: id } : undefined;
  }
}

const uncertain = (reason: string): Error => new Error(`Envio incerto pelo Mailpit (${reason})`);

/** MAILPIT_URL precisa ser http(s); qualquer outro esquema impede a subida. */
export const mailpitUrlOf = (value: string | undefined): string => {
  if (value === undefined) throw new Error('MAILPIT_URL nao definida (EMAIL_PROVIDER=mailpit)');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('MAILPIT_URL invalida (use http://host:porta)');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MAILPIT_URL invalida (use http://host:porta)');
  }
  return url.toString();
};
