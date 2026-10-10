// Porta do armazenamento privado de arquivos (ENT-010 file_object_key; S3 privado em homologacao e
// producao, com o adaptador junto da infraestrutura AWS). A chave nunca sai na API nem nos logs.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface ObjectStorage {
  put(key: string, body: Buffer): Promise<void>;
  /** undefined quando o objeto nao existe. */
  get(key: string): Promise<Buffer | undefined>;
  /** Remover objeto inexistente nao e erro. */
  delete(key: string): Promise<void>;
}

/** Em memoria: testes. */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  get size(): number {
    return this.objects.size;
  }

  clear(): void {
    this.objects.clear();
  }

  put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(body));
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer | undefined> {
    const body = this.objects.get(key);
    return Promise.resolve(body === undefined ? undefined : Buffer.from(body));
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/** Em diretorio local: desenvolvimento (EXPORT_STORAGE_DIR). */
export class FileSystemObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathOf(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error('Chave de objeto invalida');
    return path;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.pathOf(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }
}

/** Sem armazenamento configurado: toda operacao falha (a exportacao termina FAILED). */
export const unconfiguredObjectStorage: ObjectStorage = {
  put: () => Promise.reject(new Error('Armazenamento nao configurado (EXPORT_STORAGE_DIR)')),
  get: () => Promise.reject(new Error('Armazenamento nao configurado (EXPORT_STORAGE_DIR)')),
  delete: () => Promise.reject(new Error('Armazenamento nao configurado (EXPORT_STORAGE_DIR)')),
};
