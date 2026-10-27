// Binario fixado do Terraform (infraestrutura, DC-071). A versao e os SHA-256 abaixo vem do
// SHA256SUMS da release oficial (assinatura GPG da HashiCorp conferida ao fixar) e sao conferidos a
// cada download. Cache: node_modules/.cache/terraform/<versao>/ (ou TERRAFORM_CACHE_DIR/<versao>/).
// TERRAFORM_BASE_URL permite um espelho da release (o SHA-256 continua obrigatorio).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TERRAFORM_VERSION = '1.16.5';

const SHA256 = {
  darwin_arm64: 'ecdef65e24193d627f27c39baeda31295f08c938d8a3d4764f442fb916d4b7dc',
  linux_amd64: '2bc2fcfff033265c9e02ca0351f01794eb122f62a9b2a49a3294b9e49eaab5e4',
  linux_arm64: '61a50b00485ee4810cf20581ef080fc54d34d666e175c58d9a10501c65c1ccde',
  windows_amd64: '01700102b7291f95c0ab61394b55bfd5f57a12ac65632c2c1958691c8cf438ef',
};

const DOWNLOAD_TIMEOUT_MS = 120_000;
/** Escrita apenas depois de baixar, verificar e extrair: sem ela, o cache e descartado. */
const MARKER = '.verified';
const BIN = process.platform === 'win32' ? 'terraform.exe' : 'terraform';

function platformKey() {
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  const os = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  const key = os && arch ? `${os}_${arch}` : undefined;
  if (!key || !(key in SHA256)) {
    throw new Error(
      `terraform: plataforma sem binario fixado (${process.platform}/${process.arch})`,
    );
  }
  return key;
}

/** Devolve o caminho do binario, baixando e verificando o SHA-256 quando o cache nao e valido. */
export async function ensureTerraform(root) {
  const key = platformKey();
  const cacheRoot =
    process.env.TERRAFORM_CACHE_DIR || join(root, 'node_modules', '.cache', 'terraform');
  const dir = join(cacheRoot, TERRAFORM_VERSION);
  if (existsSync(join(dir, MARKER)) && existsSync(join(dir, BIN))) return join(dir, BIN);

  const asset = `terraform_${TERRAFORM_VERSION}_${key}.zip`;
  const base =
    process.env.TERRAFORM_BASE_URL ||
    `https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/`;
  const url = new URL(asset, base).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`terraform: download falhou (${String(response.status)}) ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== SHA256[key]) {
    throw new Error(`terraform: SHA-256 divergente para ${asset} (obtido ${digest})`);
  }

  // Extrai em diretorio temporario e so entao troca pelo definitivo: uma execucao interrompida
  // nunca deixa um binario truncado no lugar do valido.
  mkdirSync(cacheRoot, { recursive: true });
  const staging = mkdtempSync(join(cacheRoot, `.staging-${TERRAFORM_VERSION}-`));
  try {
    writeFileSync(join(staging, asset), bytes);
    // zip: unzip no Linux e no macOS; o tar (bsdtar) do Windows 10+ tambem le zip.
    const [command, args] =
      process.platform === 'win32' ? ['tar', ['-xf', asset]] : ['unzip', ['-q', asset]];
    const extract = spawnSync(command, args, { cwd: staging, encoding: 'utf8' });
    if (extract.status !== 0 || !existsSync(join(staging, BIN))) {
      throw new Error(
        `terraform: falha ao extrair ${asset}: ${extract.stderr || String(extract.error)}`,
      );
    }
    rmSync(join(staging, asset), { force: true });
    writeFileSync(join(staging, MARKER), `${digest}\n`, 'utf8');
    rmSync(dir, { recursive: true, force: true });
    try {
      renameSync(staging, dir);
    } catch (error) {
      // Outra execucao concorrente pode ter instalado primeiro; vale se estiver completa.
      if (!(existsSync(join(dir, MARKER)) && existsSync(join(dir, BIN)))) throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return join(dir, BIN);
}
