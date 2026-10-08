// Porta de envio de e-mail (OA-004: SES em homologacao e producao; o adaptador entra com a
// infraestrutura AWS). Logs nunca levam o destinatario completo nem o conteudo (ADR-001 secao 7).

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Sem provedor configurado: falha, e o pg-boss refaz o job quando houver provedor. */
export const unconfiguredEmailSender: EmailSender = {
  send: () => Promise.reject(new Error('Provedor de e-mail nao configurado (EMAIL_PROVIDER)')),
};
