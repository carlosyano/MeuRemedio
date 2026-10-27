// @trace RN-014 RN-018 DEC-005 (envio de e-mail pelo SES, DC-069)
// Adaptador SES da porta EmailSender: o aceite devolve o MessageId, a recusa do SES (falha do
// cliente) vira EmailRejectedError e o resto fica incerto. Nenhum erro leva o destinatario nem o
// texto do provedor, que pode citar o endereco.
import { SendEmailCommand, SESv2ServiceException } from '@aws-sdk/client-sesv2';
import { describe, expect, it } from 'vitest';
import {
  EmailRejectedError,
  unconfiguredEmailSender,
} from '../../apps/api/src/platform/email/email-sender.js';
import {
  emailSenderFromEnv,
  type SesCommands,
  SesEmailSender,
} from '../../apps/api/src/platform/email/ses-email-sender.js';

const fakeClient = (reply: (command: SendEmailCommand) => Promise<unknown>) => {
  const sent: SendEmailCommand[] = [];
  const client = {
    send: (command: SendEmailCommand) => {
      sent.push(command);
      return reply(command);
    },
  } as SesCommands;
  return { client, sent };
};

const sesError = (name: string, fault: 'client' | 'server', status: number) =>
  new SESv2ServiceException({
    name,
    $fault: fault,
    $metadata: { httpStatusCode: status },
    message: 'Email address is not verified: ana.silva@example.com',
  });

const MESSAGE = {
  to: 'ana.silva@example.com',
  subject: 'Lembrete: Losartana as 08:00',
  text: 'Esta na hora de Losartana (08:00).',
  reference: '0b6c3f0e-0000-4000-8000-000000000001',
};

const sender = (client: SesCommands, configurationSet?: string) =>
  new SesEmailSender({
    client,
    from: 'MeuRemedio <nao-responda@example.com>',
    ...(configurationSet === undefined ? {} : { configurationSet }),
  });

describe('SesEmailSender', () => {
  it('envia texto simples em UTF-8 do remetente configurado e devolve o MessageId', async () => {
    const { client, sent } = fakeClient(() => Promise.resolve({ MessageId: 'ses-0001' }));

    const receipt = await sender(client).send(MESSAGE);

    expect(receipt).toEqual({ providerMessageId: 'ses-0001' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeInstanceOf(SendEmailCommand);
    expect(sent[0]?.input).toMatchObject({
      FromEmailAddress: 'MeuRemedio <nao-responda@example.com>',
      Destination: { ToAddresses: ['ana.silva@example.com'] },
      Content: {
        Simple: {
          Subject: { Data: MESSAGE.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: MESSAGE.text, Charset: 'UTF-8' } },
        },
      },
    });
  });

  it('a referencia opaca vai como tag e o configuration set para a conciliacao (DEC-005)', async () => {
    const { client, sent } = fakeClient(() => Promise.resolve({ MessageId: 'ses-0002' }));

    await sender(client, 'meuremedio-events').send(MESSAGE);

    expect(sent[0]?.input.EmailTags).toEqual([{ Name: 'reference', Value: MESSAGE.reference }]);
    expect(sent[0]?.input.ConfigurationSetName).toBe('meuremedio-events');
  });

  it('sem referencia e sem configuration set, nenhum dos dois vai', async () => {
    const { client, sent } = fakeClient(() => Promise.resolve({ MessageId: 'ses-0003' }));

    await sender(client).send({ to: MESSAGE.to, subject: MESSAGE.subject, text: MESSAGE.text });

    expect(sent[0]?.input.EmailTags).toBeUndefined();
    expect(sent[0]?.input.ConfigurationSetName).toBeUndefined();
  });

  it('aceite sem MessageId devolve undefined (aceito, sem evidencia)', async () => {
    const { client } = fakeClient(() => Promise.resolve({}));

    await expect(sender(client).send(MESSAGE)).resolves.toBeUndefined();
  });

  it.each([
    ['MessageRejected', 400],
    ['AccountSuspendedException', 400],
    ['TooManyRequestsException', 429],
  ])('recusa do SES (%s) vira EmailRejectedError', async (name, status) => {
    const { client } = fakeClient(() => Promise.reject(sesError(name, 'client', status)));

    const error = await sender(client)
      .send(MESSAGE)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmailRejectedError);
    expect((error as Error).message).toContain(name);
  });

  it('falha do servidor do SES fica incerta (nao e EmailRejectedError)', async () => {
    const { client } = fakeClient(() => Promise.reject(sesError('InternalFailure', 'server', 500)));

    const error = await sender(client)
      .send(MESSAGE)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EmailRejectedError);
  });

  it('falha de rede ou timeout fica incerta', async () => {
    const { client } = fakeClient(() =>
      Promise.reject(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' })),
    );

    const error = await sender(client)
      .send(MESSAGE)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(EmailRejectedError);
  });

  it('nenhum erro leva o destinatario nem o texto do provedor', async () => {
    for (const failure of [
      sesError('MessageRejected', 'client', 400),
      sesError('InternalFailure', 'server', 500),
    ]) {
      const { client } = fakeClient(() => Promise.reject(failure));
      const error = (await sender(client)
        .send(MESSAGE)
        .catch((e: unknown) => e)) as Error;

      expect(error.message).not.toContain('ana.silva@example.com');
      expect(error.message).not.toContain('not verified');
      expect(error.cause).toBeUndefined();
    }
  });
});

describe('emailSenderFromEnv', () => {
  it('EMAIL_PROVIDER=ses com EMAIL_FROM escolhe o SES', () => {
    const email = emailSenderFromEnv({
      EMAIL_PROVIDER: 'ses',
      EMAIL_FROM: 'nao-responda@example.com',
      AWS_REGION: 'sa-east-1',
    });
    expect(email).toBeInstanceOf(SesEmailSender);
  });

  it('sem EMAIL_PROVIDER, o envio fica sem provedor', () => {
    expect(emailSenderFromEnv({})).toBe(unconfiguredEmailSender);
    expect(emailSenderFromEnv({ EMAIL_PROVIDER: '' })).toBe(unconfiguredEmailSender);
  });

  it('SES sem EMAIL_FROM ou provedor desconhecido impedem a subida', () => {
    expect(() => emailSenderFromEnv({ EMAIL_PROVIDER: 'ses' })).toThrow('EMAIL_FROM');
    expect(() => emailSenderFromEnv({ EMAIL_PROVIDER: 'smtp' })).toThrow('EMAIL_PROVIDER');
  });
});
