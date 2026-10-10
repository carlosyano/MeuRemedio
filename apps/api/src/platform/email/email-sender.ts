// Porta de envio de e-mail (OA-004: SES em homologacao e producao; o adaptador entra com a
// infraestrutura AWS). Logs nunca levam o destinatario completo nem o conteudo (ADR-001 secao 7).

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /**
   * Referencia interna opaca (ex.: id do lembrete), enviada como tag da mensagem para a
   * conciliacao por eventos do provedor (DEC-005). Nunca leva dado pessoal.
   */
  readonly reference?: string;
}

/** Evidencia do aceite tecnico pelo provedor (RN-014: aceito, nao entregue nem lido). */
export interface EmailReceipt {
  readonly providerMessageId: string;
}

/**
 * Recusa definitiva do provedor: a mensagem com certeza nao foi aceita. Qualquer outro erro
 * (timeout, rede, queda) deixa o envio incerto.
 */
export class EmailRejectedError extends Error {
  public override readonly name = 'EmailRejectedError';
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailReceipt | undefined>;
}

/**
 * Sem provedor configurado: recusa definitiva (nada saiu). O e-mail de verificacao e refeito pelo
 * pg-boss; o lembrete termina FAILED PROVIDER_REJECTED, sem ficar incerto.
 */
export const unconfiguredEmailSender: EmailSender = {
  send: () =>
    Promise.reject(new EmailRejectedError('Provedor de e-mail nao configurado (EMAIL_PROVIDER)')),
};
