// Utilitarios dos formularios da web (DC-053): leitura de campos, regras espelhadas do contrato
// (a API valida de novo), erros por campo vindos do Problem e Idempotency-Key estavel para o
// mesmo payload (repetir o envio igual nao cria efeito novo; payload novo usa chave nova).
import { ApiProblem } from './api-client';

export type FieldErrors = Readonly<Record<string, string>>;

export const PASSWORD_RULE =
  'A senha precisa ter de 10 a 72 caracteres, com letra minúscula, letra maiúscula e número.';
export const PASSWORD_HINT =
  'Mínimo de 10 caracteres, com letra minúscula, letra maiúscula e número.';

/** Mesmo padrao da OpenAPI (CreateAccountRequest.password e PasswordResetConfirmRequest). */
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,72}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidPassword = (value: string): boolean => PASSWORD_PATTERN.test(value);
export const isValidEmail = (value: string): boolean =>
  value.length <= 254 && EMAIL_PATTERN.test(value.trim());

export function textOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export const isChecked = (form: FormData, name: string): boolean => form.get(name) === 'on';

/** Erros por campo do 400 da API (field_errors[].message ja vem em pt-BR, DC-007). */
export function apiFieldErrors(error: unknown, fields: readonly string[]): FieldErrors {
  if (!(error instanceof ApiProblem)) return {};
  const result: Record<string, string> = {};
  for (const item of error.fieldErrors) {
    if (fields.includes(item.field) && result[item.field] === undefined) {
      result[item.field] = item.message;
    }
  }
  return result;
}

export function createIdempotencyKeys(): (payload: unknown) => string {
  let last: { json: string; key: string } | undefined;
  return (payload) => {
    const json = JSON.stringify(payload);
    if (last?.json !== json) last = { json, key: crypto.randomUUID() };
    return last.key;
  };
}

/** Le e remove da URL o token do fragmento (#token=...), para ele nao ficar no historico. */
export function takeTokenFromFragment(): string | undefined {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (window.location.hash !== '') {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return match?.[1];
}
