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
import { soundRoutes } from './routes/sounds.ts';
import { parseAdminEmails } from './auth.ts';
import { seedPresets } from './presets.ts';
import { dbPath, rulebookDir, soundsDir } from './paths.ts';
import { BUILTIN_SOUND_PREFIX, createSoundLibrary, soundBaseUrl } from './sounds.ts';

const CLIENT_DIST = join(import.meta.dirname, '../../client/dist');

/** Standard-Sounds samt `/sounds/default` ohne Schrägstrich: nie die Startseite der App als Antwort */
const isSoundPath = (url: string) => {
  const path = url.split('?')[0];
  return path.startsWith(BUILTIN_SOUND_PREFIX) || path === BUILTIN_SOUND_PREFIX.slice(0, -1);
};
/** Alles, was nicht die API ist, beantworten die statischen Auslieferungen (Sounds, gebautes Frontend) */
const isStaticPath = (url: string) => !url.startsWith('/api/');

export interface AppOptions {
  logger?: boolean;
  /** kommagetrennt; Vorgabe ist die Umgebungsvariable ADMIN_EMAILS */
  adminEmails?: string;
  /** Ordner mit den PDF-Dateien der Regelwerke; Vorgabe ist data/rulebooks neben der Datenbank */
  rulebookDir?: string;
  /** Ordner der Standard-Sounds samt sounds.json; Vorgabe ist SOUNDS_DIR bzw. server/sounds/default */
  soundsDir?: string;
  /** URL, unter der die Standard-Sounds abrufbar sind (z.B. ein CDN); Vorgabe ist SOUNDS_BASE_URL bzw. /sounds/default/ */
  soundsBaseUrl?: string;
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const admins = parseAdminEmails(opts.adminEmails ?? process.env.ADMIN_EMAILS);
  seedPresets(db);
  app.register(cookie);

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err.validation) return reply.code(400).send({ error: `Ungültige Eingabe: ${err.message}` });
    // Abgewiesene Pfade der statischen Auslieferung (z.B. „..“, Dotfiles) sehen aus wie fehlende Dateien
    if (err.statusCode === 403 && isStaticPath(req.url)) return reply.code(404).send({ error: 'Nicht gefunden' });
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
  const sounds = opts.soundsDir ?? soundsDir();
  const library = createSoundLibrary(sounds, soundBaseUrl(opts.soundsBaseUrl ?? process.env.SOUNDS_BASE_URL), (err) =>
    app.log.error(`Sound-Manifest nicht übernommen, die bisherige Liste bleibt aktiv: ${err.message}`),
  );
  soundRoutes(app, library, sounds);

  // Produktion: gebautes Frontend ausliefern (im Dev-Betrieb übernimmt das Vite).
  if (existsSync(CLIENT_DIST)) {
    app.register(fastifyStatic, { root: CLIENT_DIST });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || isSoundPath(req.url)) return reply.code(404).send({ error: 'Nicht gefunden' });
    if (existsSync(CLIENT_DIST)) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Frontend nicht gebaut (npm run build)' });
  });

  return app;
}
