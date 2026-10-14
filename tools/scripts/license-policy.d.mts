// Tipos de license-policy.mjs para os testes em TypeScript.
export declare const ALLOWED_LICENSES: ReadonlySet<string>;
export declare const FAMILY_EXCEPTIONS: readonly {
  readonly namePrefix: string;
  readonly license: string;
  readonly reason: string;
}[];
export declare const REVIEWED_EXCEPTIONS: Readonly<Record<string, string>>;
export declare function licenseViolations(
  components: readonly {
    readonly name: string;
    readonly version: string;
    readonly purl?: string;
    readonly licenses?: readonly unknown[];
  }[],
): string[];
