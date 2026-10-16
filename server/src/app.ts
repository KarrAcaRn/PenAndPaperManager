import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { Db } from './db.ts';
import { HttpError } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { groupRoutes } from './routes/groups.ts';
import { memberRoutes } from './routes/members.ts';
import { articleRoutes } from './routes/articles.ts';
import { folderRoutes } from './routes/folders.ts';
import { presetRoutes } from './routes/presets.ts';
import { skillRoutes } from './routes/skills.ts';
import { sheetRoutes } from './routes/sheets.ts';
import { rulebookRoutes } from './routes/rulebooks.ts';
import { storageRoutes } from './routes/storage.ts';
import { googleDriveRoutes } from './routes/googleDrive.ts';
import type { StorageContext } from './storage/connections.ts';
import { defaultStorageProviders, type StorageProviderRegistry } from './storage/registry.ts';
import { createSecretBox, loadSecretKey, type SecretBox } from './secrets.ts';
import { parseAdminEmails } from './auth.ts';
import { seedPresets } from './presets.ts';
import { dbPath, rulebookDir } from './paths.ts';

const CLIENT_DIST = join(import.meta.dirname, '../../client/dist');

export interface AppOptions {
  logger?: boolean;
  /** Log-Ausgabe umleiten (Tests); schaltet das Logging ein */
  logStream?: { write(line: string): void };
  /** kommagetrennt; Vorgabe ist die Umgebungsvariable ADMIN_EMAILS */
  adminEmails?: string;
  /** Ordner mit den PDF-Dateien der Regelwerke; Vorgabe ist data/rulebooks neben der Datenbank */
  rulebookDir?: string;
  /** Anbieter externer Speicher (Soundboard); Vorgabe sind die eingebauten (defaultStorageProviders) */
  storageProviders?: StorageProviderRegistry;
  /** Schlüssel für gespeicherte Zugangsdaten; Vorgabe APP_SECRET_KEY bzw. data/secret.key, erst bei Bedarf geladen */
  secretKey?: Buffer;
}

/** Query-Parameter, die nie im Log landen dürfen (OAuth-Code und -State, Wiedergabe-Tickets) */
const SECRET_QUERY_PARAMS = ['code', 'state', 't'];

/** URL fürs Log: geheime Query-Parameter werden durch [entfernt] ersetzt */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  for (const name of SECRET_QUERY_PARAMS) if (params.has(name)) params.set(name, '[entfernt]');
  return `${url.slice(0, q)}?${params}`;
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const logging = opts.logger ?? opts.logStream !== undefined;
  const app = Fastify({
    logger: logging && {
      ...(opts.logStream ? { stream: opts.logStream } : {}),
      serializers: {
        req: (req: FastifyRequest) => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }),
      },
    },
  });
  const admins = parseAdminEmails(opts.adminEmails ?? process.env.ADMIN_EMAILS);
  seedPresets(db);
  app.register(cookie);

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err.validation) return reply.code(400).send({ error: `Ungültige Eingabe: ${err.message}` });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'Interner Fehler' });
  });

  authRoutes(app, db, admins);
  groupRoutes(app, db);
  memberRoutes(app, db);
  articleRoutes(app, db);
  folderRoutes(app, db);
  presetRoutes(app, db, admins);
  skillRoutes(app, db);
  sheetRoutes(app, db);
  rulebookRoutes(app, db, opts.rulebookDir ?? rulebookDir(dbPath()));
  let secrets: SecretBox | undefined;
  const storage: StorageContext = {
    db,
    secrets: () => (secrets ??= createSecretBox(opts.secretKey ?? loadSecretKey(dbPath()))),
    providers: opts.storageProviders ?? defaultStorageProviders(),
  };
  storageRoutes(app, storage);
  googleDriveRoutes(app, storage);

  // Produktion: gebautes Frontend ausliefern (im Dev-Betrieb übernimmt das Vite).
  if (existsSync(CLIENT_DIST)) {
    app.register(fastifyStatic, { root: CLIENT_DIST });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    if (existsSync(CLIENT_DIST)) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Frontend nicht gebaut (npm run build)' });
  });

  return app;
}
