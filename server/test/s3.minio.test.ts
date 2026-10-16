import { randomBytes } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3StorageProvider, parseS3Input, s3ClientConfig, type S3Config, type S3Credentials } from '../src/storage/s3.ts';

// Integrationstest gegen einen echten S3-kompatiblen Dienst, z.B. MinIO:
//   docker run --rm -p 9000:9000 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio-geheim minio/minio server /data
//   S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_TEST_ACCESS_KEY=minio S3_TEST_SECRET_KEY=minio-geheim npm test -w server
// Ohne S3_TEST_ENDPOINT wird er übersprungen. Der Bucket (S3_TEST_BUCKET, Vorgabe pnp-test) wird bei Bedarf angelegt.
// Dienste, die Signaturen nicht prüfen (z.B. moto_server ohne IAM), mit S3_TEST_NO_AUTH=1 laufen lassen – dann
// entfallen die Tests, die abgelehnte Signaturen erwarten.

const env = process.env;
const enabled = Boolean(env.S3_TEST_ENDPOINT);
const checksSignatures = env.S3_TEST_NO_AUTH !== '1';

describe.skipIf(!enabled)('S3 gegen echten Dienst (MinIO)', () => {
  let config: S3Config;
  let credentials: S3Credentials;
  let provider: S3StorageProvider;
  const uploaded: string[] = [];

  beforeAll(async () => {
    ({ config, credentials } = parseS3Input(
      { bucket: env.S3_TEST_BUCKET ?? 'pnp-test', region: env.S3_TEST_REGION ?? 'us-east-1', endpoint: env.S3_TEST_ENDPOINT, prefix: `lauf-${randomBytes(4).toString('hex')}` },
      { accessKeyId: env.S3_TEST_ACCESS_KEY, secretAccessKey: env.S3_TEST_SECRET_KEY },
      true,
    ));
    const admin = new S3Client(s3ClientConfig(config, credentials));
    await admin.send(new CreateBucketCommand({ Bucket: config.bucket })).catch((err: { name?: string }) => {
      if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') throw err;
    });
    provider = new S3StorageProvider(config, credentials);
  });

  afterAll(async () => {
    for (const key of uploaded) await provider?.delete(key).catch(() => {});
  });

  it('prüft die Verbindung', async () => {
    await provider.validate();
    expect((await provider.listFiles({ folder: '', limit: 10 })).files).toEqual([]);
  });

  it('lädt per presigned PUT hoch, listet, spielt ab und löscht', async () => {
    const audio = Buffer.from('ID3 kein echtes mp3, reicht aber');
    const target = await provider.upload({ fileName: 'test.mp3', contentType: 'audio/mpeg', size: audio.length });
    const put = await fetch(target.url, { method: target.method, headers: target.headers, body: audio });
    expect(put.status).toBe(200);
    uploaded.push(target.fileId!);

    const page = await provider.listFiles({ folder: '', limit: 10 });
    expect(page.files.map((f) => [f.name, f.size])).toEqual([['test.mp3', audio.length]]);

    const { url } = await provider.getPlaybackUrl(target.fileId!);
    const get = await fetch(url);
    expect(Buffer.from(await get.arrayBuffer())).toEqual(audio);

    await provider.delete(target.fileId!);
    await expect(provider.getPlaybackUrl(target.fileId!)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it.skipIf(!checksSignatures)('weist Uploads mit anderer Größe oder anderem Typ als angemeldet ab', async () => {
    const target = await provider.upload({ fileName: 'falsch.mp3', contentType: 'audio/mpeg', size: 5 });
    uploaded.push(target.fileId!);
    expect((await fetch(target.url, { method: 'PUT', headers: target.headers, body: Buffer.alloc(500) })).ok).toBe(false);
    expect((await fetch(target.url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: Buffer.alloc(5) })).ok).toBe(false);
  });

  it.skipIf(!checksSignatures)('meldet falsche Zugangsdaten als auth', async () => {
    const wrong = new S3StorageProvider(config, { ...credentials, secretAccessKey: 'falsch' });
    await expect(wrong.validate()).rejects.toMatchObject({ kind: 'auth' });
  });
});
