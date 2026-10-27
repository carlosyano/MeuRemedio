// @trace RN-014 RN-018 DEC-005 (envio de e-mail pelo Mailpit no ambiente local, DC-073)
// Adaptador da porta EmailSender para a caixa local do Mailpit (docker compose): o aceite devolve
// o ID, a recusa (4xx) vira EmailRejectedError e o resto fica incerto. Nenhum erro leva o
// destinatario nem o corpo da resposta.
import { describe, expect, it } from 'vitest';
import { EmailRejectedError } from '../../apps/api/src/platform/email/email-sender.js';
import { MailpitEmailSender } from '../../apps/api/src/platform/email/mailpit-email-sender.js';
import { emailSenderFromEnv } from '../../apps/api/src/platform/email/ses-email-sender.js';

const MESSAGE = {
  to: 'ana.silva@example.com',
  subject: 'Confirme seu e-mail',
  text: 'Abra o link para confirmar.',
  reference: '0b6c3f0e-0000-4000-8000-000000000001',
};

interface Call {
  readonly url: string;
  readonly method: string | undefined;
  readonly body: string;
}

const fakeFetch = (reply: () => Promise<Response>) => {
  const calls: Call[] = [];
  const fetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url: href, method: init?.method, body });
    return reply();
  };
  return { fetch, calls };
};

const sender = (fetch: typeof globalThis.fetch) =>
  new MailpitEmailSender({
    baseUrl: 'http://mailpit:8025',
    from: 'MeuRemedio <nao-responda@meuremedio.local>',
    fetch,
  });

describe('MailpitEmailSender', () => {
  it('envia pela API do Mailpit e devolve o ID da mensagem', async () => {
    const { fetch, calls } = fakeFetch(() =>
      Promise.resolve(Response.json({ ID: 'mp-0001' }, { status: 200 })),
    );

    const receipt = await sender(fetch).send(MESSAGE);

    expect(receipt).toEqual({ providerMessageId: 'mp-0001' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://mailpit:8025/api/v1/send');
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      From: { Email: 'nao-responda@meuremedio.local', Name: 'MeuRemedio' },
      To: [{ Email: 'ana.silva@example.com' }],
      Subject: 'Confirme seu e-mail',
      Text: 'Abra o link para confirmar.',
      Tags: ['0b6c3f0e-0000-4000-8000-000000000001'],
    });
  });

  it('remetente sem nome e mensagem sem referencia', async () => {
    const { fetch, calls } = fakeFetch(() => Promise.resolve(Response.json({ ID: 'mp-0002' })));
    const plain = new MailpitEmailSender({
      baseUrl: 'http://localhost:8025/',
      from: 'nao-responda@meuremedio.local',
      fetch,
    });

    await plain.send({ to: MESSAGE.to, subject: MESSAGE.subject, text: MESSAGE.text });

    expect(calls[0]?.url).toBe('http://localhost:8025/api/v1/send');
    const body = JSON.parse(calls[0]?.body ?? '') as Record<string, unknown>;
    expect(body['From']).toEqual({ Email: 'nao-responda@meuremedio.local' });
    expect(body).not.toHaveProperty('Tags');
  });

  it('4xx do Mailpit e recusa definitiva, sem o corpo da resposta', async () => {
    const { fetch } = fakeFetch(() =>
      Promise.resolve(Response.json({ Error: 'invalid ana.silva@example.com' }, { status: 400 })),
    );

    const error = await sender(fetch)
      .send(MESSAGE)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailRejectedError);
    expect((error as Error).message).toContain('400');
    expect(JSON.stringify(error)).not.toContain('ana.silva');
    expect((error as Error).message).not.toContain('ana.silva');
    expect((error as Error).cause).toBeUndefined();
  });

  it('aceite sem ID devolve undefined (aceito, sem evidencia), como no SES', async () => {
    const { fetch } = fakeFetch(() => Promise.resolve(Response.json({})));

    expect(await sender(fetch).send(MESSAGE)).toBeUndefined();
  });

  it('5xx ou falha de rede deixam o envio incerto', async () => {
    const failures: (() => Promise<Response>)[] = [
      () => Promise.resolve(new Response('falha', { status: 500 })),
      () => Promise.reject(new TypeError('fetch failed ana.silva@example.com')),
    ];
    for (const reply of failures) {
      const { fetch } = fakeFetch(reply);

      const error = await sender(fetch)
        .send(MESSAGE)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(EmailRejectedError);
      expect((error as Error).message).toContain('Envio incerto pelo Mailpit');
      expect((error as Error).message).not.toContain('ana.silva');
      expect((error as Error).cause).toBeUndefined();
    }
  });
});

describe('emailSenderFromEnv com Mailpit', () => {
  it('EMAIL_PROVIDER=mailpit com MAILPIT_URL e EMAIL_FROM escolhe o Mailpit', () => {
    const chosen = emailSenderFromEnv({
      EMAIL_PROVIDER: 'mailpit',
      MAILPIT_URL: 'http://mailpit:8025',
      EMAIL_FROM: 'nao-responda@meuremedio.local',
    });
    expect(chosen).toBeInstanceOf(MailpitEmailSender);
  });

  it('Mailpit sem MAILPIT_URL, sem EMAIL_FROM ou com URL que nao e http impede a subida', () => {
    const from = { EMAIL_FROM: 'nao-responda@meuremedio.local' };
    expect(() => emailSenderFromEnv({ EMAIL_PROVIDER: 'mailpit', ...from })).toThrow('MAILPIT_URL');
    expect(() =>
      emailSenderFromEnv({ EMAIL_PROVIDER: 'mailpit', MAILPIT_URL: 'http://mailpit:8025' }),
    ).toThrow('EMAIL_FROM');
    expect(() =>
      emailSenderFromEnv({ EMAIL_PROVIDER: 'mailpit', MAILPIT_URL: 'file:///etc', ...from }),
    ).toThrow('MAILPIT_URL');
  });
});
