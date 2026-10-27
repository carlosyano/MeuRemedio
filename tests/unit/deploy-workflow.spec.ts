// @trace-exempt teste de infraestrutura do CD (DC-072), sem ID normativo: protege as premissas de
// seguranca dos workflows do GitHub Actions.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflows = new URL('../../.github/workflows/', import.meta.url);

interface Job {
  readonly environment?: string;
  readonly permissions?: Record<string, string>;
  readonly steps?: readonly { readonly uses?: string; readonly run?: string }[];
}
interface Workflow {
  readonly on: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
  readonly jobs: Record<string, Job>;
}

const files = readdirSync(workflows).filter((file) => /\.ya?ml$/.test(file));
const load = (file: string): Workflow =>
  parse(readFileSync(new URL(file, workflows), 'utf8')) as Workflow;
const text = (file: string): string => readFileSync(new URL(file, workflows), 'utf8');

describe('workflows do GitHub Actions', () => {
  it('toda action de terceiros e fixada por SHA de commit', () => {
    for (const file of files) {
      for (const job of Object.values(load(file).jobs)) {
        for (const step of job.steps ?? []) {
          if (step.uses === undefined || step.uses.startsWith('./')) continue;
          expect(step.uses, `${file}: ${step.uses}`).toMatch(/@[0-9a-f]{40}$/);
        }
      }
    }
  });

  it('so o job de implantacao pede o token OIDC (id-token: write)', () => {
    for (const file of files) {
      const workflow = load(file);
      expect(workflow.permissions?.['id-token'], file).toBeUndefined();
      for (const [name, job] of Object.entries(workflow.jobs)) {
        const allowed = file === 'deploy.yml' && name === 'deploy';
        if (!allowed) expect(job.permissions?.['id-token'], `${file}/${name}`).toBeUndefined();
      }
    }
  });
});

describe('deploy.yml', () => {
  const deploy = load('deploy.yml');

  it('roda so por acionamento manual, nunca em push ou pull request', () => {
    expect(Object.keys(deploy.on)).toEqual(['workflow_dispatch']);
  });

  it('o job usa o environment homologacao, cujo revisor libera o token OIDC', () => {
    expect(deploy.jobs['deploy']?.environment).toBe('homologacao');
    expect(deploy.jobs['deploy']?.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(deploy.permissions).toEqual({ contents: 'read' });
  });

  it('nao usa segredo de longa duracao: so variaveis do environment e o papel por OIDC', () => {
    expect(text('deploy.yml')).not.toMatch(/secrets\./);
    expect(text('deploy.yml')).not.toMatch(/aws-access-key-id|aws-secret-access-key/);
  });
});
