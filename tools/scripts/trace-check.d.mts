// Tipos de trace-check.mjs para os testes em TypeScript.
export interface TraceInput {
  readonly ids: ReadonlySet<string>;
  readonly operations: ReadonlySet<string>;
  /** RF -> testes sentinela associados na matriz. */
  readonly requirements: Readonly<Record<string, readonly string[]>>;
  /** TS -> status dos artefatos de teste na matriz (implemented ou planned). */
  readonly sentinelTests: Readonly<Record<string, readonly string[]>>;
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

export declare function checkTraceability(input: TraceInput): {
  errors: string[];
  pending: string[];
};

export declare function loadInput(root: string): TraceInput;
