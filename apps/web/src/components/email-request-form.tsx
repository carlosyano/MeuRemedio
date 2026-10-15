'use client';
// Pedido por e-mail com resposta neutra da API (reenvio da confirmacao e esqueci a senha; DC-053):
// a mensagem exibida e a da propria resposta 202, sem revelar se a conta existe.
import { useState, type SubmitEvent } from 'react';
import { FormAlert, SubmitButton, TextField } from '@/components/fields';
import { messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { isValidEmail, textOf } from '@/lib/forms';

export function EmailRequestForm({ path }: { readonly path: string }) {
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | undefined>();
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const email = textOf(new FormData(event.currentTarget), 'email').trim();
    if (!isValidEmail(email)) {
      setFieldError('Informe um e-mail válido.');
      setAlert('Revise os campos destacados e tente novamente.');
      return;
    }
    setFieldError(undefined);
    setAlert(undefined);
    setBusy(true);
    try {
      const response = await api.request<{ message: string }>({
        method: 'POST',
        path,
        body: { email },
      });
      setDone(response.body.message);
    } catch (error) {
      setAlert(messageFor(error));
      setBusy(false);
    }
  }

  if (done !== undefined) return <p role="status">{done}</p>;
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={busy}>
      <TextField id="email" label="E-mail" type="email" autoComplete="email" error={fieldError} />
      <FormAlert message={alert} />
      <SubmitButton label="Enviar link" busyLabel="Enviando…" busy={busy} />
    </form>
  );
}
