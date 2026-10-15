'use client';
// Redefinicao de senha (RF-002, RN-017; DC-044, DC-053): o token vem no fragmento do link e sai da
// URL assim que e lido. Sucesso so com o 204; link usado ou expirado leva a pedir outro.
import Link from 'next/link';
import { useEffect, useState, type SubmitEvent } from 'react';
import { FormAlert, SubmitButton, TextField } from '@/components/fields';
import { ApiProblem, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import {
  PASSWORD_HINT,
  PASSWORD_RULE,
  apiFieldErrors,
  isValidPassword,
  takeTokenFromFragment,
  textOf,
  type FieldErrors,
} from '@/lib/forms';

const LINK_UNUSABLE = 'Este link não pode mais ser usado. Solicite um novo.';
const NOT_ACTIVE = 'Esta conta não pode redefinir a senha agora.';

export function ResetForm() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | undefined>();
  const [linkUnusable, setLinkUnusable] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    const found = takeTokenFromFragment() ?? null;
    setToken(found);
    if (found === null) {
      setAlert(LINK_UNUSABLE);
      setLinkUnusable(true);
    }
  }, []);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (typeof token !== 'string') return;
    const form = new FormData(event.currentTarget);
    const password = textOf(form, 'new_password');
    const invalid: Record<string, string> = {};
    if (!isValidPassword(password)) invalid['new_password'] = PASSWORD_RULE;
    else if (password !== textOf(form, 'confirmation')) {
      invalid['confirmation'] = 'As senhas não coincidem.';
    }
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) {
      setAlert('Revise os campos destacados e tente novamente.');
      return;
    }
    setBusy(true);
    setAlert(undefined);
    try {
      await api.request({
        method: 'POST',
        path: '/password-resets',
        body: { token, new_password: password },
      });
      setDone(true);
    } catch (error) {
      setErrors(apiFieldErrors(error, ['new_password']));
      if (error instanceof ApiProblem && error.code === 'TOKEN_EXPIRED') {
        setLinkUnusable(true);
        setAlert(LINK_UNUSABLE);
      } else if (error instanceof ApiProblem && error.code === 'STATE_CONFLICT') {
        setAlert(NOT_ACTIVE);
      } else {
        setAlert(messageFor(error));
      }
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <p role="status" className="mb-4">
          Senha alterada. Por segurança, todas as sessões foram encerradas.
        </p>
        <Link href="/entrar">Entrar</Link>
      </>
    );
  }
  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={busy}>
      <TextField
        id="new_password"
        label="Nova senha"
        type="password"
        autoComplete="new-password"
        description={PASSWORD_HINT}
        error={errors['new_password']}
      />
      <TextField
        id="confirmation"
        label="Confirme a nova senha"
        type="password"
        autoComplete="new-password"
        error={errors['confirmation']}
      />
      <FormAlert message={alert} />
      {linkUnusable && (
        <p className="mb-4">
          <Link href="/conta/esqueci-senha">Pedir novo link</Link>
        </p>
      )}
      <SubmitButton
        label="Salvar nova senha"
        busyLabel="Salvando…"
        busy={busy || token === undefined}
      />
    </form>
  );
}
