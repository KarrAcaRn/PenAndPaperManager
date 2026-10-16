import type { FastifyInstance } from 'fastify';
import {
  MAX_STORAGE_DISPLAY_NAME_LENGTH,
  MAX_STORAGE_FILE_ID_LENGTH,
  MAX_STORAGE_FILE_NAME_LENGTH,
  MAX_STORAGE_FOLDER_LENGTH,
  MAX_STORAGE_PAGE_SIZE,
  MAX_STORAGE_UPLOAD_BYTES,
  STORAGE_PROVIDER_TYPES,
  isAudioFile,
  uploadMatchesAudio,
  type StorageConfig,
  type StorageConnectionInput,
  type StorageFilePage,
  type UploadRequest,
} from '@pnp/shared';
import { requireUser } from '../auth.ts';
import { badRequest } from '../errors.ts';
import { intParams, nonBlank, objectOf } from '../schemas.ts';
import { connect, deleteConnection, getConnection, listConnections, withProvider, type StorageContext } from '../storage/connections.ts';
import { StorageProviderError } from '../storage/provider.ts';

// Externe Speicher der Nutzer fürs Soundboard (docs/soundboard-storage.md). Jeder sieht und nutzt nur seine eigenen
// Verbindungen; Zugangsdaten gehen nur hinein, nie hinaus.

const cidParams = intParams('cid');

/** Frei geformte Objekte der Anbieter, grob begrenzt; die genaue Prüfung macht parseInput des Anbieters. */
const looseObject = { type: 'object', maxProperties: 20 };

const connectionBody = objectOf({
  providerType: { enum: STORAGE_PROVIDER_TYPES },
  displayName: nonBlank(MAX_STORAGE_DISPLAY_NAME_LENGTH),
  config: looseObject,
  credentials: looseObject,
});

const fileIdQuery = objectOf({ fileId: { type: 'string', minLength: 1, maxLength: MAX_STORAGE_FILE_ID_LENGTH } });

const listQuery = objectOf(
  {
    folder: { type: 'string', maxLength: MAX_STORAGE_FOLDER_LENGTH, default: '' },
    cursor: { type: 'string', minLength: 1, maxLength: 4096 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_STORAGE_PAGE_SIZE, default: 100 },
  },
  [],
);

const uploadBody = objectOf({
  fileName: nonBlank(MAX_STORAGE_FILE_NAME_LENGTH),
  contentType: { type: 'string', maxLength: 100 },
  size: { type: 'integer', minimum: 1, maximum: MAX_STORAGE_UPLOAD_BYTES },
});

/** Unterordner relativ zum verbundenen Ordner: ohne führende/abschließende '/', ohne '.', '..' und '\' */
export function parseStorageFolder(raw: string): string {
  const folder = raw.trim().replace(/^\/+|\/+$/g, '');
  if (folder === '') return '';
  const parts = folder.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || /[\\\u0000-\u001f\u007f]/.test(p))) {
    throw badRequest('Ungültiger Ordner');
  }
  return folder;
}

/** Dateiname ohne Pfadanteile, damit niemand per Name aus dem verbundenen Ordner ausbricht */
function parseUploadName(raw: string): string {
  const name = raw.trim();
  if (/[/\\]/.test(name) || name === '.' || name === '..') throw badRequest('Der Dateiname darf keine Ordner enthalten');
  return name;
}

export function storageRoutes(app: FastifyInstance, ctx: StorageContext): void {
  const { db } = ctx;

  app.get('/api/storage/providers', (req) => {
    requireUser(db, req);
    return ctx.providers.list();
  });

  app.get('/api/storage/connections', (req) => {
    const user = requireUser(db, req);
    return listConnections(db, user.id);
  });

  app.post('/api/storage/connections', { schema: { body: connectionBody } }, async (req, reply) => {
    const user = requireUser(db, req);
    const body = req.body as StorageConnectionInput;
    const definition = ctx.providers.get(body.providerType);
    if (!definition.parseInput) throw badRequest('Dieser Anbieter wird über seine eigene Anmeldung verbunden');
    let parsed: { config: StorageConfig; credentials: unknown };
    try {
      parsed = definition.parseInput(body.config, body.credentials);
    } catch (err) {
      if (err instanceof StorageProviderError) throw badRequest(err.message);
      throw err;
    }
    const connection = await connect(ctx, user.id, {
      providerType: body.providerType,
      displayName: body.displayName.trim(),
      config: parsed.config,
      credentials: parsed.credentials,
    });
    reply.code(201);
    return connection;
  });

  app.delete('/api/storage/connections/:cid', { schema: { params: cidParams } }, (req) => {
    const user = requireUser(db, req);
    deleteConnection(db, user.id, (req.params as { cid: number }).cid);
    return { ok: true };
  });

  /** Prüft die Verbindung erneut; der Status wird gespeichert, auch wenn die Prüfung fehlschlägt. */
  app.post('/api/storage/connections/:cid/test', { schema: { params: cidParams } }, async (req) => {
    const user = requireUser(db, req);
    const { cid } = req.params as { cid: number };
    await withProvider(ctx, user.id, cid, (provider) => provider.validate());
    return getConnection(db, user.id, cid);
  });

  app.get(
    '/api/storage/connections/:cid/files',
    { schema: { params: cidParams, querystring: listQuery } },
    async (req): Promise<StorageFilePage> => {
      const user = requireUser(db, req);
      const { folder, cursor, limit } = req.query as { folder: string; cursor?: string; limit: number };
      const options = { folder: parseStorageFolder(folder), limit, ...(cursor === undefined ? {} : { cursor }) };
      const page = await withProvider(ctx, user.id, (req.params as { cid: number }).cid, (p) => p.listFiles(options));
      // Sicherheitsnetz: nur Audiodateien, auch wenn ein Anbieter mehr liefert
      return { files: page.files.filter(isAudioFile), nextCursor: page.nextCursor };
    },
  );

  app.get(
    '/api/storage/connections/:cid/playback-url',
    { schema: { params: cidParams, querystring: fileIdQuery } },
    async (req) => {
      const user = requireUser(db, req);
      const { fileId } = req.query as { fileId: string };
      return withProvider(ctx, user.id, (req.params as { cid: number }).cid, (p) => p.getPlaybackUrl(fileId));
    },
  );

  app.post(
    '/api/storage/connections/:cid/uploads',
    { schema: { params: cidParams, body: uploadBody } },
    async (req) => {
      const user = requireUser(db, req);
      const body = req.body as UploadRequest;
      const request: UploadRequest = { fileName: parseUploadName(body.fileName), contentType: body.contentType.trim().toLowerCase(), size: body.size };
      if (!uploadMatchesAudio(request.fileName, request.contentType)) {
        throw badRequest('Nur Audiodateien (mp3, wav, ogg, m4a) mit passendem Dateityp sind erlaubt');
      }
      return withProvider(ctx, user.id, (req.params as { cid: number }).cid, (p) => p.upload(request));
    },
  );

  app.delete(
    '/api/storage/connections/:cid/files',
    { schema: { params: cidParams, querystring: fileIdQuery } },
    async (req) => {
      const user = requireUser(db, req);
      const { fileId } = req.query as { fileId: string };
      await withProvider(ctx, user.id, (req.params as { cid: number }).cid, (p) => p.delete(fileId));
      return { ok: true };
    },
  );
}
