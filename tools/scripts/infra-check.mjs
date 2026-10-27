// npm run infra:check (DC-071): formato, validacao e testes do Terraform em infra/terraform, sem
// credencial da AWS nem estado remoto. Os testes do modulo (terraform test) usam um provedor
// simulado (mock_provider) e provam as propriedades de seguranca do plano. Os ambientes so passam
// por init sem backend e validate.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureTerraform } from './terraform-bin.mjs';

const root = new URL('../../', import.meta.url).pathname;
const infra = join(root, 'infra', 'terraform');
const terraform = await ensureTerraform(root);
const env = { ...process.env, TF_IN_AUTOMATION: '1', CHECKPOINT_DISABLE: '1' };

const run = (cwd, args) => {
  const result = spawnSync(terraform, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`infra:check: terraform ${args.join(' ')} falhou em ${cwd}`);
    process.exit(result.status ?? 1);
  }
};

run(infra, ['fmt', '-check', '-recursive', '-diff']);

const moduleDir = join(infra, 'modules', 'platform');
run(moduleDir, ['init', '-backend=false', '-input=false', '-lockfile=readonly']);
run(moduleDir, ['validate']);
run(moduleDir, ['test']);

const envsDir = join(infra, 'envs');
for (const name of readdirSync(envsDir)) {
  const dir = join(envsDir, name);
  run(dir, ['init', '-backend=false', '-input=false', '-lockfile=readonly']);
  run(dir, ['validate']);
}
console.log('infra:check: Terraform sem erros.');
