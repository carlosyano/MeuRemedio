// Binario fixado do oasdiff (QG-001). O oasdiff e distribuido como binario Go, nao como pacote npm:
// a versao e os SHA-256 abaixo vem do checksums.txt da release oficial e sao conferidos a cada download.
// Cache: node_modules/.cache/oasdiff/<versao>/ (fora do controle de versao). Ver docs/architecture/TOOLCHAIN.md.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OASDIFF_VERSION = '1.33.0';

const SHA256 = {
  darwin_all: '2a479337c15afdcbf0b1e89c0b4d0cf0176472dbc11483358fed1f831d1e46c5',
  linux_amd64: '43a4e328e2d13ba1552d760aa68d2485c75c5621f309f6ff64ae895188345247',
  linux_arm64: '4ae3c362d6074d919aada2dea82d0ee84366591600384455d0bdc658ddf8f7ae',
  windows_amd64: '22f98c7247075f8a446e783595802d6d38637de1760df264f3d4b3309f766c5b',
  windows_arm64: 'd51bd1ea4b05ff9b314245d1e97f84c222b22ce34a930e8e305c68c32edbe951',
};

function platformKey() {
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (process.platform === 'darwin') return 'darwin_all';
  const os = { linux: 'linux', win32: 'windows' }[process.platform];
  const key = os && arch ? `${os}_${arch}` : undefined;
  if (!key || !(key in SHA256)) {
    throw new Error(`oasdiff: plataforma sem binario fixado (${process.platform}/${process.arch})`);
  }
  return key;
}

/** Devolve o caminho do binario, baixando e verificando o SHA-256 na primeira chamada. */
export async function ensureOasdiff(root = process.cwd()) {
  const key = platformKey();
  const dir = join(root, 'node_modules', '.cache', 'oasdiff', OASDIFF_VERSION);
  const bin = join(dir, process.platform === 'win32' ? 'oasdiff.exe' : 'oasdiff');
  if (existsSync(bin)) return bin;

  const asset = `oasdiff_${OASDIFF_VERSION}_${key}.tar.gz`;
  const url = `https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/${asset}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`oasdiff: download falhou (${String(response.status)}) ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== SHA256[key]) {
    throw new Error(`oasdiff: SHA-256 divergente para ${asset} (obtido ${digest})`);
  }

  mkdirSync(dir, { recursive: true });
  const archive = join(dir, asset);
  writeFileSync(archive, bytes);
  // cwd + nome relativo: evita que o GNU tar interprete "C:" como host remoto no Windows.
  const tar = spawnSync('tar', ['-xzf', asset], { cwd: dir, encoding: 'utf8' });
  rmSync(archive, { force: true });
  if (tar.status !== 0 || !existsSync(bin)) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`oasdiff: falha ao extrair ${asset}: ${tar.stderr || String(tar.error)}`);
  }
  return bin;
}
