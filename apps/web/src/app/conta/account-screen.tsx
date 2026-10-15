'use client';
// Conta (DC-061): dados da conta com o nome editavel e o fuso imutavel (RF-001, CA-015),
// preferencias de acessibilidade aplicadas na hora (RF-009) e encerramento de todas as sessoes
// com reautenticacao (RF-002, TS-044). Sucesso so com a resposta da API (RN-015).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { AppNav } from '@/components/app-nav';
import { FormAlert, TextField } from '@/components/fields';
import { TEXT_SCALES, applyPreferences, type AccessibilityPreferences } from '@/lib/accessibility';
import { ApiProblem, messageFor } from '@/lib/api-client';
import { api } from '@/lib/browser-api';
import { createIdempotencyKeys, textOf, type FieldErrors } from '@/lib/forms';
import { loginPath, useAccount } from '@/lib/use-account';

const VALIDATION = 'Revise os campos destacados e tente novamente.';
const WRONG_PASSWORD =
  'Não foi possível confirmar a senha. Confira e tente de novo; depois de 5 tentativas erradas, aguarde 15 minutos.';

type Section = 'nome' | 'preferencias' | 'sessoes';

interface Feedback {
  readonly section: Section;
  readonly kind: 'status' | 'alert';
  readonly text: string;
}

function SectionFeedback(props: { readonly section: Section; readonly feedback?: Feedback }) {
  const feedback = props.feedback;
  if (feedback?.section !== props.section) return null;
  if (feedback.kind === 'alert') return <FormAlert message={feedback.text} />;
  return (
    <p role="status" className="mb-4 font-medium">
      {feedback.text}
    </p>
  );
}

const buttonClass = 'rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-70';

export function AccountScreen() {
  const router = useRouter();
  const account = useAccount('/conta');
  const [name, setName] = useState<string | undefined>();
  const [preferences, setPreferences] = useState<AccessibilityPreferences | undefined>();
  const [feedback, setFeedback] = useState<Feedback | undefined>();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<Section | undefined>();
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const keyFor = useRef(createIdempotencyKeys());
  const panelHeading = useRef<HTMLHeadingElement>(null);

  const accountName = account.status === 'ready' ? account.account.name : undefined;
  useEffect(() => {
    if (accountName !== undefined) setName(accountName);
  }, [accountName]);

  const accountReady = account.status === 'ready';
  useEffect(() => {
    if (!accountReady) return;
    api
      .request<AccessibilityPreferences>({ method: 'GET', path: '/preferences/accessibility' })
      .then((response) => {
        setPreferences(response.body);
      })
      .catch((error: unknown) => {
        setFeedback({ section: 'preferencias', kind: 'alert', text: messageFor(error) });
      });
  }, [accountReady]);

  useEffect(() => {
    if (revoking) panelHeading.current?.focus();
  }, [revoking]);

  function failed(section: Section, error: unknown): void {
    if (error instanceof ApiProblem && error.status === 401) {
      router.replace(loginPath('/conta'));
      return;
    }
    setFeedback({ section, kind: 'alert', text: messageFor(error) });
  }

  async function saveName(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = textOf(new FormData(event.currentTarget), 'name').trim();
    if (value === '' || value.length > 120) {
      setErrors({ name: 'Informe seu nome.' });
      setFeedback({ section: 'nome', kind: 'alert', text: VALIDATION });
      return;
    }
    setErrors({});
    setBusy('nome');
    setFeedback(undefined);
    try {
      const response = await api.request<{ name: string }>({
        method: 'PUT',
        path: '/accounts/me',
        body: { name: value },
      });
      setName(response.body.name);
      setFeedback({ section: 'nome', kind: 'status', text: 'Nome atualizado.' });
    } catch (error) {
      failed('nome', error);
    } finally {
      setBusy(undefined);
    }
  }

  async function savePreferences(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: AccessibilityPreferences = {
      text_scale: Number(textOf(form, 'text_scale')),
      high_contrast: form.get('high_contrast') === 'on',
    };
    setBusy('preferencias');
    setFeedback(undefined);
    try {
      const response = await api.request<AccessibilityPreferences>({
        method: 'PUT',
        path: '/preferences/accessibility',
        body,
      });
      setPreferences(response.body);
      applyPreferences(document.documentElement, response.body);
      setFeedback({ section: 'preferencias', kind: 'status', text: 'Preferências salvas.' });
    } catch (error) {
      failed('preferencias', error);
    } finally {
      setBusy(undefined);
    }
  }

  /** 401 da reautenticacao: senha errada (sessao valida) ou sessao encerrada. */
  async function sessionStillValid(): Promise<boolean> {
    try {
      await api.request({ method: 'GET', path: '/accounts/me' });
      return true;
    } catch {
      return false;
    }
  }

  async function revokeAll(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const password = textOf(new FormData(event.currentTarget), 'password');
    if (password === '') {
      setErrors({ password: 'Informe sua senha.' });
      setFeedback({ section: 'sessoes', kind: 'alert', text: VALIDATION });
      return;
    }
    const body = { password };
    setErrors({});
    setBusy('sessoes');
    setFeedback(undefined);
    try {
      await api.request({
        method: 'POST',
        path: '/sessions/revocations',
        body,
        idempotencyKey: keyFor.current(body),
      });
      setRevoked(true);
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 401 && (await sessionStillValid())) {
        setErrors({ password: 'Senha incorreta.' });
        setFeedback({ section: 'sessoes', kind: 'alert', text: WRONG_PASSWORD });
      } else {
        failed('sessoes', error);
      }
    } finally {
      setBusy(undefined);
    }
  }

  if (account.status === 'error') return <FormAlert message={account.message} />;
  if (account.status === 'loading' || name === undefined) {
    return <p aria-live="polite">Carregando…</p>;
  }

  if (revoked) {
    return (
      <>
        <h1 className="mb-4 text-2xl font-semibold">Conta</h1>
        <p role="status" className="mb-4 font-medium">
          Todas as sessões foram encerradas, inclusive esta. Entre novamente para continuar.
        </p>
        <p>
          <Link href="/entrar">Entrar</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <AppNav />
      <h1 className="mb-6 text-2xl font-semibold">Conta</h1>

      <section aria-labelledby="dados-titulo" className="mb-8">
        <h2 id="dados-titulo" className="mb-2 text-xl font-semibold">
          Dados da conta
        </h2>
        <dl className="mb-4">
          <dt className="font-medium">E-mail</dt>
          <dd className="mb-2">{account.account.email}</dd>
          <dt className="font-medium">Fuso horário</dt>
          <dd>
            {account.account.account_timezone}
            <span className="block text-sm text-muted">O fuso horário não pode ser alterado.</span>
          </dd>
        </dl>
        <form onSubmit={(event) => void saveName(event)} noValidate aria-busy={busy === 'nome'}>
          <TextField
            id="name"
            label="Nome"
            autoComplete="name"
            maxLength={120}
            defaultValue={name}
            error={errors['name']}
          />
          <SectionFeedback section="nome" {...(feedback === undefined ? {} : { feedback })} />
          <button type="submit" disabled={busy !== undefined} className={buttonClass}>
            {busy === 'nome' ? 'Salvando…' : 'Salvar nome'}
          </button>
        </form>
      </section>

      <section aria-labelledby="acessibilidade-titulo" className="mb-8">
        <h2 id="acessibilidade-titulo" className="mb-2 text-xl font-semibold">
          Acessibilidade
        </h2>
        {preferences === undefined ? (
          <SectionFeedback
            section="preferencias"
            {...(feedback === undefined ? {} : { feedback })}
          />
        ) : (
          <form
            onSubmit={(event) => void savePreferences(event)}
            noValidate
            aria-busy={busy === 'preferencias'}
          >
            <div className="mb-4">
              <label htmlFor="text_scale" className="mb-1 block font-medium">
                Tamanho do texto
              </label>
              <select
                id="text_scale"
                name="text_scale"
                defaultValue={String(preferences.text_scale)}
                className="w-full rounded border border-line bg-surface p-2"
              >
                {TEXT_SCALES.map((scale) => (
                  <option key={scale} value={String(scale)}>
                    {scale === 100 ? '100% (padrão)' : `${String(scale)}%`}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4 flex items-center gap-2">
              <input
                id="high_contrast"
                name="high_contrast"
                type="checkbox"
                defaultChecked={preferences.high_contrast}
                className="size-5"
              />
              <label htmlFor="high_contrast">Alto contraste</label>
            </div>
            <SectionFeedback
              section="preferencias"
              {...(feedback === undefined ? {} : { feedback })}
            />
            <button type="submit" disabled={busy !== undefined} className={buttonClass}>
              {busy === 'preferencias' ? 'Salvando…' : 'Salvar preferências'}
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="sessoes-titulo">
        <h2 id="sessoes-titulo" className="mb-2 text-xl font-semibold">
          Sessões
        </h2>
        {revoking ? (
          <section aria-labelledby="encerrar-titulo" className="rounded border border-line p-4">
            <h3
              id="encerrar-titulo"
              ref={panelHeading}
              tabIndex={-1}
              className="mb-2 text-lg font-semibold"
            >
              Encerrar todas as sessões
            </h3>
            <p className="mb-4">
              Encerra o acesso em todos os dispositivos, inclusive neste. Depois, é preciso entrar
              de novo.
            </p>
            <form
              onSubmit={(event) => void revokeAll(event)}
              noValidate
              aria-busy={busy === 'sessoes'}
            >
              <TextField
                id="password"
                label="Senha atual"
                type="password"
                autoComplete="current-password"
                maxLength={72}
                error={errors['password']}
              />
              <SectionFeedback
                section="sessoes"
                {...(feedback === undefined ? {} : { feedback })}
              />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy !== undefined} className={buttonClass}>
                  {busy === 'sessoes' ? 'Encerrando…' : 'Encerrar sessões'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRevoking(false);
                    setErrors({});
                    setFeedback(undefined);
                  }}
                  className="rounded border border-line px-4 py-2"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => {
              setRevoking(true);
            }}
            className="rounded border border-line px-4 py-2"
          >
            Encerrar todas as sessões
          </button>
        )}
      </section>
    </>
  );
}
