// Adaptador S3 da porta ObjectStorage (homologacao e producao; DC-068). O bucket e privado e
// cifrado com KMS (RNF-002); o objeto vai com SSE-KMS explicito, para a politica do bucket poder
// recusar envio sem cifragem. A chave do objeto nunca vai para mensagens de erro nem logs.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  FileSystemObjectStorage,
  type ObjectStorage,
  unconfiguredObjectStorage,
} from './object-storage.js';

/** O que o adaptador usa do S3Client (o teste troca por um duble). */
export interface S3Commands {
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
  send(command: PutObjectCommand | DeleteObjectCommand): Promise<unknown>;
}

export interface S3ObjectStorageOptions {
  readonly client: S3Commands;
  readonly bucket: string;
  /** Chave KMS do bucket (id, ARN ou alias); sem ela, vale a chave padrao do bucket. */
  readonly kmsKeyId?: string;
}

// mesmo limite de file_object_key (DATA_MODEL ENT-010)
const MAX_KEY_LENGTH = 512;

const checkKey = (key: string): void => {
  if (key === '' || key.length > MAX_KEY_LENGTH) throw new Error('Chave de objeto invalida');
};

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Commands;
  private readonly bucket: string;
  private readonly kmsKeyId: string | undefined;

  constructor(options: S3ObjectStorageOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.kmsKeyId = options.kmsKeyId;
  }

  async put(key: string, body: Buffer): Promise<void> {
    checkKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ServerSideEncryption: 'aws:kms',
        ...(this.kmsKeyId === undefined ? {} : { SSEKMSKeyId: this.kmsKeyId }),
      }),
    );
  }

  async get(key: string): Promise<Buffer | undefined> {
    checkKey(key);
    let output: GetObjectCommandOutput;
    try {
      output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      // NoSuchKey exige s3:ListBucket; sem ela o S3 responde AccessDenied, que sobe como falha
      if (error instanceof Error && error.name === 'NoSuchKey') return undefined;
      throw error;
    }
    if (output.Body === undefined) return undefined;
    return Buffer.from(await output.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    checkKey(key);
    // o S3 trata a remocao de objeto inexistente como sucesso
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

const valueOf = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
};

/**
 * Armazenamento das exportacoes pelo ambiente: EXPORT_STORAGE_BUCKET (S3, com
 * EXPORT_STORAGE_KMS_KEY_ID opcional e a regiao e as credenciais pela cadeia padrao da AWS, ou
 * seja, o papel da tarefa no ECS) ou EXPORT_STORAGE_DIR (diretorio local em desenvolvimento).
 * Os dois juntos sao ambiguos e impedem a subida; nenhum deixa toda operacao falhando.
 */
export const objectStorageFromEnv = (env: NodeJS.ProcessEnv): ObjectStorage => {
  const bucket = valueOf(env, 'EXPORT_STORAGE_BUCKET');
  const dir = valueOf(env, 'EXPORT_STORAGE_DIR');
  if (bucket !== undefined && dir !== undefined) {
    throw new Error('EXPORT_STORAGE_BUCKET e EXPORT_STORAGE_DIR definidas: escolha uma');
  }
  if (bucket !== undefined) {
    const kmsKeyId = valueOf(env, 'EXPORT_STORAGE_KMS_KEY_ID');
    const region = valueOf(env, 'AWS_REGION');
    return new S3ObjectStorage({
      client: new S3Client(region === undefined ? {} : { region }),
      bucket,
      ...(kmsKeyId === undefined ? {} : { kmsKeyId }),
    });
  }
  if (dir !== undefined) return new FileSystemObjectStorage(dir);
  return unconfiguredObjectStorage;
};
