import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
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
import { parseAdminEmails } from './auth.ts';
import { seedPresets } from './presets.ts';
import { dbPath, rulebookDir } from './paths.ts';

const CLIENT_DIST = join(import.meta.dirname, '../../client/dist');

export interface AppOptions {
  logger?: boolean;
  /** kommagetrennt; Vorgabe ist die Umgebungsvariable ADMIN_EMAILS */
  adminEmails?: string;
  /** Ordner mit den PDF-Dateien der Regelwerke; Vorgabe ist data/rulebooks neben der Datenbank */
  rulebookDir?: string;
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
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
