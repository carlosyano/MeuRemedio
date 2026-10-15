'use client';
// TL-001 (DC-053): inicial; preenchimento; validacao; enviando; sucesso; erro; rate limit.
// O fuso vem do navegador e pode ser trocado; ele nao muda depois (RN-013). Sucesso so com o 201.
import Link from 'next/link';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { CheckboxField, FormAlert, SubmitButton, TextField } from '@/components/fields';
import { ApiProblem, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import {
  PASSWORD_HINT,
  PASSWORD_RULE,
  apiFieldErrors,
  createIdempotencyKeys,
  isChecked,
  isValidEmail,
  isValidPassword,
  textOf,
  type FieldErrors,
} from '@/lib/forms';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from '@/lib/legal';

const VALIDATION = 'Revise os campos destacados e tente novamente.';
const EMAIL_TAKEN = 'Já existe uma conta com este e-mail. Entre ou redefina a senha.';

function validate(form: FormData): FieldErrors {
  const errors: Record<string, string> = {};
  const name = textOf(form, 'name').trim();
  if (name === '' || name.length > 120) errors['name'] = 'Informe seu nome.';
  if (!isValidEmail(textOf(form, 'email'))) errors['email'] = 'Informe um e-mail válido.';
  if (!isValidPassword(textOf(form, 'password'))) errors['password'] = PASSWORD_RULE;
  if (textOf(form, 'account_timezone') === '') {
    errors['account_timezone'] = 'Escolha o fuso horário.';
  }
  if (!isChecked(form, 'terms_accepted')) {
    errors['terms_accepted'] = 'É preciso aceitar os Termos de uso.';
  }
  if (!isChecked(form, 'privacy_notice_acknowledged')) {
    errors['privacy_notice_acknowledged'] =
      'É preciso confirmar a leitura do Aviso de privacidade.';
  }
  return errors;
}

export function SignupForm() {
  const [zones, setZones] = useState<readonly string[]>([]);
  const [zone, setZone] = useState('');
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string | undefined>();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [sentTo, setSentTo] = useState<string | undefined>();
  const keyFor = useRef(createIdempotencyKeys());

  // Fuso e lista so no navegador: o servidor nao sabe o fuso do titular.
  useEffect(() => {
    setZones(Intl.supportedValuesOf('timeZone'));
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const invalid = validate(form);
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) {
      setAlert(VALIDATION);
      return;
    }
    const body = {
      name: textOf(form, 'name').trim(),
      email: textOf(form, 'email').trim(),
      password: textOf(form, 'password'),
      account_timezone: textOf(form, 'account_timezone'),
      terms_version: TERMS_VERSION,
      privacy_notice_version: PRIVACY_NOTICE_VERSION,
      terms_accepted: true,
      privacy_notice_acknowledged: true,
    };
    setBusy(true);
    setAlert(undefined);
    try {
      await api.request({
        method: 'POST',
        path: '/accounts',
        body,
        idempotencyKey: keyFor.current(body),
      });
      setSentTo(body.email);
    } catch (error) {
      setErrors(apiFieldErrors(error, Object.keys(body)));
      setAlert(
        error instanceof ApiProblem && error.code === 'STATE_CONFLICT'
          ? EMAIL_TAKEN
          : messageFor(error),
      );
      setBusy(false);
    }
  }

  if (sentTo !== undefined) {
    return (
      <div role="status">
        <p className="mb-4">
          Enviamos um link de confirmação para {sentTo}. Abra-o em até 24 horas para ativar a conta.
        </p>
        <p>
          Não recebeu? <Link href="/conta/reenviar-verificacao">Reenviar o link</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={busy}>
      <TextField
        id="name"
        label="Nome"
        autoComplete="name"
        maxLength={120}
        error={errors['name']}
      />
      <TextField
        id="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        error={errors['email']}
      />
      <TextField
        id="password"
        label="Senha"
        type="password"
        autoComplete="new-password"
        description={PASSWORD_HINT}
        error={errors['password']}
      />
      <div className="mb-4">
        <label htmlFor="account_timezone" className="mb-1 block font-medium">
          Fuso horário
        </label>
        <p id="account_timezone-descricao" className="mb-1 text-sm text-muted">
          Os horários dos medicamentos seguem este fuso. Ele não pode ser trocado depois.
        </p>
        <select
          id="account_timezone"
          name="account_timezone"
          value={zone}
          onChange={(event) => {
            setZone(event.target.value);
          }}
          aria-describedby="account_timezone-descricao"
          aria-invalid={errors['account_timezone'] === undefined ? undefined : true}
          className="w-full rounded border border-line p-2"
        >
          {zones.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {errors['account_timezone'] !== undefined && (
          <p className="mt-1 text-sm font-medium text-danger">{errors['account_timezone']}</p>
        )}
      </div>
      <CheckboxField
        id="terms_accepted"
        label="Li e aceito os Termos de uso"
        error={errors['terms_accepted']}
      />
      <CheckboxField
        id="privacy_notice_acknowledged"
        label="Li o Aviso de privacidade"
        error={errors['privacy_notice_acknowledged']}
      />
      <p className="mb-4 text-sm">
        Leia os <Link href="/termos">Termos de uso</Link> e o{' '}
        <Link href="/aviso-de-privacidade">Aviso de privacidade</Link>.
      </p>
      <FormAlert message={alert} />
      <SubmitButton label="Criar conta" busyLabel="Criando conta…" busy={busy} />
      <p className="mt-6">
        Já tem conta? <Link href="/entrar">Entrar</Link>
      </p>
    </form>
  );
}
