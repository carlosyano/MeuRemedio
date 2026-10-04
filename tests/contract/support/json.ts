// Tipos e acessores minimos para ler documentos YAML/JSON sem usar `any`.
export type Json = null | boolean | number | string | Json[] | JsonObject;
export interface JsonObject {
  [key: string]: Json;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asObject(value: unknown, what: string): JsonObject {
  if (!isObject(value)) throw new Error(`${what}: objeto esperado`);
  return value;
}

export function asArray(value: unknown, what: string): Json[] {
  if (!Array.isArray(value)) throw new Error(`${what}: lista esperada`);
  return value as Json[];
}

export function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what}: texto esperado`);
  return value;
}

export function asStrings(value: unknown, what: string): string[] {
  return asArray(value, what).map((item, index) => asString(item, `${what}[${String(index)}]`));
}

/** Desce por chaves de objetos aninhados, falhando se algum passo nao for objeto. */
export function dig(root: JsonObject, ...path: string[]): JsonObject {
  let current: Json = root;
  for (const key of path) {
    current = asObject(current, path.join('.'))[key] ?? null;
  }
  return asObject(current, path.join('.'));
}
