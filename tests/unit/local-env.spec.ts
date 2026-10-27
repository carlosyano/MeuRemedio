// @trace-exempt ambiente local com docker compose (DC-073), sem ID normativo: o .env gerado traz
// segredos aleatorios proprios da maquina e nunca sobrescreve um existente; o compose.yaml so
// escuta em 127.0.0.1, fixa as imagens de terceiros por digest e usa o Mailpit, nunca o SES.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { LOCAL_SECRETS, writeLocalEnv } from '../../tools/scripts/local-env.mjs';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mr-local-env-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const parse = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );

describe('npm run local:env', () => {
  it('gera os tres segredos HMAC com 32 bytes aleatorios em base64', () => {
    const dir = tempDir();

    expect(writeLocalEnv(dir)).toBe(true);

    const env = parse(readFileSync(join(dir, '.env'), 'utf8'));
    expect(Object.keys(env).sort()).toEqual([...LOCAL_SECRETS].sort());
    for (const name of LOCAL_SECRETS) {
      expect(Buffer.from(env[name] ?? '', 'base64')).toHaveLength(32);
    }
    expect(new Set(Object.values(env)).size).toBe(LOCAL_SECRETS.length);
  });

  it('cada maquina recebe segredos diferentes', () => {
    const [a, b] = [tempDir(), tempDir()];
    writeLocalEnv(a);
    writeLocalEnv(b);

    expect(readFileSync(join(a, '.env'), 'utf8')).not.toBe(readFileSync(join(b, '.env'), 'utf8'));
  });

  it('nao sobrescreve um .env existente', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'REQUEST_HASH_KEY=meu\n', 'utf8');

    expect(writeLocalEnv(dir)).toBe(false);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('REQUEST_HASH_KEY=meu\n');
  });
});

interface ComposeService {
  readonly image?: string;
  readonly build?: unknown;
  readonly pull_policy?: string;
  readonly ports?: readonly string[];
  readonly environment?: Record<string, string>;
}

describe('compose.yaml', () => {
  const compose = parseYaml(readFileSync(new URL('../../compose.yaml', import.meta.url), 'utf8'), {
    merge: true,
  }) as { services: Record<string, ComposeService> };
  const services = Object.entries(compose.services);

  it('so a web e o Mailpit publicam porta, e so em 127.0.0.1', () => {
    const published = services.filter(([, service]) => service.ports !== undefined);
    expect(published.map(([name]) => name).sort()).toEqual(['mailpit', 'web']);
    for (const [name, service] of published) {
      for (const port of service.ports ?? []) expect(port, name).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('imagem de terceiros fixada por digest; as do projeto sao construidas do Dockerfile', () => {
    const built = new Set(
      services.flatMap(([, service]) => (service.build === undefined ? [] : [service.image])),
    );
    for (const [name, service] of services) {
      if (service.build !== undefined) continue;
      if (built.has(service.image)) {
        // imagem do projeto construida por outro servico: nunca baixada de um registro
        expect(service.pull_policy, name).toBe('never');
        continue;
      }
      expect(service.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });

  it('cada imagem do projeto e construida por um servico so (builds iguais em paralelo)', () => {
    const builders = services
      .filter(([, service]) => service.build !== undefined)
      .map(([, service]) => service.image);
    expect(builders).toHaveLength(new Set(builders).size);
    expect(builders.sort()).toEqual(['meuremedio-api:local', 'meuremedio-web:local']);
  });

  it('o worker envia pelo Mailpit e os segredos vem do .env, sem valor no arquivo', () => {
    expect(compose.services['worker']?.environment?.['EMAIL_PROVIDER']).toBe('mailpit');
    for (const [name, service] of services) {
      for (const secret of LOCAL_SECRETS) {
        const value = service.environment?.[secret];
        if (value !== undefined) expect(value, `${name}.${secret}`).toMatch(/^\$\{/);
      }
    }
  });
});
