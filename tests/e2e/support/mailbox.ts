// Caixa de e-mail dos testes E2E: o worker grava cada mensagem em E2E_MAILBOX (global-setup).
import { readFileSync } from 'node:fs';

interface Message {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

const messages = (): Message[] => {
  const file = process.env['E2E_MAILBOX'];
  if (file === undefined) throw new Error('E2E_MAILBOX nao definida (global-setup)');
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Message);
};

/** Espera a n-esima mensagem para o endereco (1 = primeira) e devolve o link com #token=. */
export async function linkFor(to: string, nth = 1, timeoutMs = 15_000): Promise<string> {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    const found = messages().filter((message) => message.to === to)[nth - 1];
    const link = /https?:\/\/\S+#token=[A-Za-z0-9_-]+/.exec(found?.text ?? '')?.[0];
    if (link !== undefined) return link;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`nenhum e-mail ${String(nth)} para ${to}`);
}
