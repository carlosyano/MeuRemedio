// @trace RF-008 RNF-002 (armazenamento privado dos PDFs no S3, DC-068)
// Adaptador S3 da porta ObjectStorage: o objeto vai cifrado com KMS, o objeto inexistente vira
// undefined e qualquer outra falha sobe. A escolha do armazenamento vem do ambiente.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import {
  FileSystemObjectStorage,
  unconfiguredObjectStorage,
} from '../../apps/api/src/platform/storage/object-storage.js';
import {
  objectStorageFromEnv,
  S3ObjectStorage,
  type S3Commands,
} from '../../apps/api/src/platform/storage/s3-object-storage.js';

type Sent = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;

const fakeClient = (reply: (command: Sent) => Promise<unknown>) => {
  const sent: Sent[] = [];
  const client = {
    send: (command: Sent) => {
      sent.push(command);
      return reply(command);
    },
  } as S3Commands;
  return { client, sent };
};

const s3Error = (name: string): Error => Object.assign(new Error(name), { name });

const bodyOf = (bytes: Uint8Array): GetObjectCommandOutput =>
  ({
    Body: { transformToByteArray: () => Promise.resolve(bytes) },
    $metadata: {},
  }) as unknown as GetObjectCommandOutput;

const KEY = 'exports/0b6c3f0e-0000-4000-8000-000000000001.pdf';

describe('S3ObjectStorage', () => {
  it('put grava no bucket com a chave e o conteudo, cifrado com KMS', async () => {
    const { client, sent } = fakeClient(() => Promise.resolve({}));
    const storage = new S3ObjectStorage({ client, bucket: 'meuremedio-exports' });

    await storage.put(KEY, Buffer.from('%PDF-1.7'));

    expect(sent).toHaveLength(1);
    const command = sent[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command?.input).toMatchObject({
      Bucket: 'meuremedio-exports',
      Key: KEY,
      ServerSideEncryption: 'aws:kms',
    });
    expect(Buffer.from((command as PutObjectCommand).input.Body as Uint8Array).toString()).toBe(
      '%PDF-1.7',
    );
    expect((command as PutObjectCommand).input.SSEKMSKeyId).toBeUndefined();
  });

  it('put usa a chave KMS configurada', async () => {
    const { client, sent } = fakeClient(() => Promise.resolve({}));
    const storage = new S3ObjectStorage({
      client,
      bucket: 'meuremedio-exports',
      kmsKeyId: 'alias/meuremedio-exports',
    });

    await storage.put(KEY, Buffer.from('x'));

    expect((sent[0] as PutObjectCommand).input.SSEKMSKeyId).toBe('alias/meuremedio-exports');
  });

  it('get devolve o conteudo do objeto', async () => {
    const { client, sent } = fakeClient(() =>
      Promise.resolve(bodyOf(new TextEncoder().encode('%PDF-1.7'))),
    );
    const storage = new S3ObjectStorage({ client, bucket: 'meuremedio-exports' });

    const body = await storage.get(KEY);

    expect(body?.toString()).toBe('%PDF-1.7');
    expect(sent[0]).toBeInstanceOf(GetObjectCommand);
    expect(sent[0]?.input).toMatchObject({ Bucket: 'meuremedio-exports', Key: KEY });
  });

  it('get devolve undefined para objeto inexistente (NoSuchKey)', async () => {
    const { client } = fakeClient(() => Promise.reject(s3Error('NoSuchKey')));
    const storage = new S3ObjectStorage({ client, bucket: 'meuremedio-exports' });

    await expect(storage.get(KEY)).resolves.toBeUndefined();
  });

  it('get propaga as outras falhas (ex.: AccessDenied)', async () => {
    const { client } = fakeClient(() => Promise.reject(s3Error('AccessDenied')));
    const storage = new S3ObjectStorage({ client, bucket: 'meuremedio-exports' });

    await expect(storage.get(KEY)).rejects.toThrow('AccessDenied');
  });

  it('delete remove o objeto, e remover objeto inexistente nao e erro', async () => {
    const { client, sent } = fakeClient(() => Promise.resolve({}));
    const storage = new S3ObjectStorage({ client, bucket: 'meuremedio-exports' });

    await storage.delete(KEY);

    expect(sent[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(sent[0]?.input).toMatchObject({ Bucket: 'meuremedio-exports', Key: KEY });
  });

  it('recusa chave vazia ou acima de 512 caracteres sem chamar o S3', async () => {
    const { client, sent } = fakeClient(() => Promise.resolve({}));
    const storage = new S3ObjectStorage({ client, bucket: 'meuremedio-exports' });

    await expect(storage.put('', Buffer.from('x'))).rejects.toThrow('Chave de objeto invalida');
    await expect(storage.get('a'.repeat(513))).rejects.toThrow('Chave de objeto invalida');
    expect(sent).toHaveLength(0);
  });

  it('a mensagem de erro nunca leva a chave do objeto', async () => {
    const { client } = fakeClient(() => Promise.resolve({}));
    const storage = new S3ObjectStorage({ client, bucket: 'meuremedio-exports' });

    const error = await storage.put('/'.repeat(513), Buffer.from('x')).catch((e: unknown) => e);

    expect(String(error)).not.toContain('/'.repeat(513));
  });
});

describe('objectStorageFromEnv', () => {
  it('EXPORT_STORAGE_BUCKET escolhe o S3', () => {
    const storage = objectStorageFromEnv({
      EXPORT_STORAGE_BUCKET: 'meuremedio-exports',
      AWS_REGION: 'sa-east-1',
    });
    expect(storage).toBeInstanceOf(S3ObjectStorage);
  });

  it('EXPORT_STORAGE_DIR escolhe o diretorio local', () => {
    const storage = objectStorageFromEnv({ EXPORT_STORAGE_DIR: '/tmp/meuremedio-exports' });
    expect(storage).toBeInstanceOf(FileSystemObjectStorage);
  });

  it('sem configuracao, toda operacao falha', () => {
    expect(objectStorageFromEnv({})).toBe(unconfiguredObjectStorage);
    expect(objectStorageFromEnv({ EXPORT_STORAGE_DIR: '', EXPORT_STORAGE_BUCKET: '' })).toBe(
      unconfiguredObjectStorage,
    );
  });

  it('bucket e diretorio juntos sao configuracao ambigua e impedem a subida', () => {
    expect(() =>
      objectStorageFromEnv({
        EXPORT_STORAGE_BUCKET: 'meuremedio-exports',
        EXPORT_STORAGE_DIR: '/tmp/meuremedio-exports',
      }),
    ).toThrow('EXPORT_STORAGE_BUCKET e EXPORT_STORAGE_DIR');
  });
});
