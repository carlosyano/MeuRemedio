// Campos de formulario acessiveis (DC-053): rotulo associado, descricao e erro ligados por
// aria-describedby, aria-invalid quando ha erro. Estilo neutro ate o design system.
import type { ReactNode } from 'react';

const describedBy = (...ids: (string | false | undefined)[]): string | undefined => {
  const value = ids.filter((id): id is string => typeof id === 'string').join(' ');
  return value === '' ? undefined : value;
};

export function TextField(props: {
  readonly id: string;
  readonly label: string;
  readonly type?: 'text' | 'email' | 'password' | 'date';
  readonly autoComplete?: string;
  readonly description?: string;
  readonly error?: string | undefined;
  readonly maxLength?: number;
  readonly defaultValue?: string;
  readonly inputMode?: 'numeric';
  /** id de um <datalist> com sugestoes. */
  readonly list?: string;
  /** Campo controlado: com `value`, informar tambem `onValueChange`. */
  readonly value?: string;
  readonly onValueChange?: (value: string) => void;
}) {
  const descriptionId = props.description === undefined ? undefined : `${props.id}-descricao`;
  const errorId = props.error === undefined ? undefined : `${props.id}-erro`;
  const onValueChange = props.onValueChange;
  return (
    <div className="mb-4">
      <label htmlFor={props.id} className="mb-1 block font-medium">
        {props.label}
      </label>
      {props.description !== undefined && (
        <p id={descriptionId} className="mb-1 text-sm text-muted">
          {props.description}
        </p>
      )}
      <input
        id={props.id}
        name={props.id}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        list={props.list}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        defaultValue={props.defaultValue}
        value={props.value}
        onChange={
          onValueChange === undefined
            ? undefined
            : (event) => {
                onValueChange(event.target.value);
              }
        }
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={describedBy(descriptionId, errorId)}
        className="w-full rounded border border-line p-2 aria-invalid:border-danger"
      />
      {props.error !== undefined && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function TextAreaField(props: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly error?: string | undefined;
  readonly maxLength?: number;
  readonly defaultValue?: string;
}) {
  const descriptionId = props.description === undefined ? undefined : `${props.id}-descricao`;
  const errorId = props.error === undefined ? undefined : `${props.id}-erro`;
  return (
    <div className="mb-4">
      <label htmlFor={props.id} className="mb-1 block font-medium">
        {props.label}
      </label>
      {props.description !== undefined && (
        <p id={descriptionId} className="mb-1 text-sm text-muted">
          {props.description}
        </p>
      )}
      <textarea
        id={props.id}
        name={props.id}
        rows={3}
        maxLength={props.maxLength}
        defaultValue={props.defaultValue}
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={describedBy(descriptionId, errorId)}
        className="w-full rounded border border-line p-2 aria-invalid:border-danger"
      />
      {props.error !== undefined && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function SelectField(props: {
  readonly id: string;
  readonly label: string;
  readonly options: readonly (readonly [value: string, label: string])[];
  readonly error?: string | undefined;
  readonly defaultValue?: string;
}) {
  const errorId = props.error === undefined ? undefined : `${props.id}-erro`;
  return (
    <div className="mb-4">
      <label htmlFor={props.id} className="mb-1 block font-medium">
        {props.label}
      </label>
      <select
        id={props.id}
        name={props.id}
        defaultValue={props.defaultValue ?? ''}
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={errorId}
        className="w-full rounded border border-line bg-surface p-2 aria-invalid:border-danger"
      >
        <option value="">Escolha</option>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {props.error !== undefined && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function CheckboxField(props: {
  readonly id: string;
  readonly label: ReactNode;
  readonly error?: string | undefined;
}) {
  const errorId = props.error === undefined ? undefined : `${props.id}-erro`;
  return (
    <div className="mb-4">
      <div className="flex items-start gap-2">
        <input
          id={props.id}
          name={props.id}
          type="checkbox"
          aria-invalid={props.error === undefined ? undefined : true}
          aria-describedby={errorId}
          className="mt-1 size-5"
        />
        <label htmlFor={props.id}>{props.label}</label>
      </div>
      {props.error !== undefined && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function FormAlert({ message }: { readonly message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p role="alert" className="mb-4 font-medium text-danger">
      {message}
    </p>
  );
}

export function SubmitButton(props: {
  readonly label: string;
  readonly busyLabel: string;
  readonly busy: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={props.busy}
      className="rounded bg-accent px-4 py-2 font-medium text-white disabled:opacity-70"
    >
      {props.busy ? props.busyLabel : props.label}
    </button>
  );
}
