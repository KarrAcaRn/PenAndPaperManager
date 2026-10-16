import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { Db } from './db.ts';
import { HttpError } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { loginCodeRoutes } from './routes/login-codes.ts';
import { RATE_LIMITS, type LoginRateLimits, type SendLoginCodeEmail } from './login-codes.ts';
import { sendLoginCodeEmail } from './mail.ts';
import { groupRoutes } from './routes/groups.ts';
import { memberRoutes } from './routes/members.ts';
import { articleRoutes } from './routes/articles.ts';
import { folderRoutes } from './routes/folders.ts';
import { presetRoutes } from './routes/presets.ts';
import { skillRoutes } from './routes/skills.ts';
import { sheetRoutes } from './routes/sheets.ts';
import { rulebookRoutes } from './routes/rulebooks.ts';
import { settingsRoutes } from './routes/settings.ts';
import { storageRoutes } from './routes/storage.ts';
import { googleDriveRoutes } from './routes/googleDrive.ts';
import type { StorageContext } from './storage/connections.ts';
import { defaultStorageProviders, type StorageProviderRegistry } from './storage/registry.ts';
import { createSecretBox, loadSecretKey, type SecretBox } from './secrets.ts';
import { themeRoutes } from './routes/themes.ts';
import { apiPath, parseAdminEmails, requireAuthForApi } from './auth.ts';
import { soundRoutes } from './routes/sounds.ts';
import { seedPresets } from './presets.ts';
import { builtinThemesDir, dbPath, rulebookDir, soundsDir, themesDir } from './paths.ts';
import { BUILTIN_SOUND_PREFIX, createSoundLibrary, soundBaseUrl } from './sounds.ts';
import { createThemeRegistry, defaultThemeId } from './themes.ts';
import { BASE_THEME_ID } from '@pnp/shared';

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
  /** Log-Ausgabe umleiten (Tests); schaltet das Logging ein */
  logStream?: { write(line: string): void };
  /** kommagetrennt; Vorgabe ist die Umgebungsvariable ADMIN_EMAILS */
  adminEmails?: string;
  /** Ordner mit den PDF-Dateien der Regelwerke; Vorgabe ist data/rulebooks neben der Datenbank */
  rulebookDir?: string;
  /** Versand der Login-Codes; Vorgabe ist `sendLoginCodeEmail` aus mail.ts, Tests fangen die Codes hier ab */
  sendLoginCodeEmail?: SendLoginCodeEmail;
  /** Rate-Limits für das Anfordern von Login-Codes; Vorgabe RATE_LIMITS (Tests mit vielen Logins lockern sie) */
  loginRateLimits?: LoginRateLimits;
  /** Ordner mit eigenen Themes des Seitenbetreibers; Vorgabe THEMES_DIR bzw. data/themes neben der Datenbank */
  themesDir?: string;
  /** Ordner der mitgelieferten Themes (für Tests); Vorgabe themes/ im Repo */
  builtinThemesDir?: string;
  /** Theme für alle ohne eigene Wahl; Vorgabe DEFAULT_THEME bzw. das Basis-Theme „default“ */
  defaultTheme?: string;
  /** Anbieter externer Speicher (Soundboard); Vorgabe sind die eingebauten (defaultStorageProviders) */
  storageProviders?: StorageProviderRegistry;
  /** Schlüssel für gespeicherte Zugangsdaten; Vorgabe APP_SECRET_KEY bzw. data/secret.key, erst bei Bedarf geladen */
  secretKey?: Buffer;
  /** Ordner der Standard-Sounds samt sounds.json; Vorgabe ist SOUNDS_DIR bzw. server/sounds/default */
  soundsDir?: string;
  /** URL, unter der die Standard-Sounds abrufbar sind (z.B. ein CDN); Vorgabe ist SOUNDS_BASE_URL bzw. /sounds/default/ */
  soundsBaseUrl?: string;
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
  const themes = createThemeRegistry({
    builtinDir: opts.builtinThemesDir ?? builtinThemesDir(),
    extraDir: opts.themesDir ?? themesDir(dbPath()),
    // Ungültige Themes werden übersprungen und bei jedem Neuladen gemeldet
    onProblems: (problems) => {
      for (const { dir, errors } of problems) app.log.warn(`Theme in ${dir} abgelehnt: ${errors.join(' ')}`);
    },
  });
  // Schon beim Start laden: ein ungültiges Basis-Theme bricht hier ab
  themes.scan();
  const configuredDefaultTheme = opts.defaultTheme ?? process.env.DEFAULT_THEME;
  if (configuredDefaultTheme && !themes.getTheme(configuredDefaultTheme)) {
    app.log.warn(`DEFAULT_THEME „${configuredDefaultTheme}“ gibt es nicht, es gilt „${BASE_THEME_ID}“.`);
  }
  const defaultTheme = () => defaultThemeId(themes, configuredDefaultTheme);
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

  // Alle API-Routen außer Login/Logout/Status verlangen eine Session (zusätzlich zu requireUser in den Routen).
  app.addHook('preValidation', requireAuthForApi(db));

  authRoutes(app, db, admins);
  loginCodeRoutes(app, db, admins, {
    sendLoginCodeEmail: opts.sendLoginCodeEmail ?? sendLoginCodeEmail,
    rateLimits: opts.loginRateLimits ?? RATE_LIMITS,
  });
  groupRoutes(app, db);
  memberRoutes(app, db);
  articleRoutes(app, db);
  folderRoutes(app, db);
  presetRoutes(app, db, admins);
  skillRoutes(app, db);
  sheetRoutes(app, db);
  rulebookRoutes(app, db, opts.rulebookDir ?? rulebookDir(dbPath()));
  settingsRoutes(app, db, themes);
  themeRoutes(app, themes, defaultTheme);
  let secrets: SecretBox | undefined;
  const storage: StorageContext = {
    db,
    secrets: () => (secrets ??= createSecretBox(opts.secretKey ?? loadSecretKey(dbPath()))),
    providers: opts.storageProviders ?? defaultStorageProviders(),
  };
  storageRoutes(app, storage);
  googleDriveRoutes(app, storage);
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
    const path = apiPath(req);
    if (path.startsWith('/api/') || isSoundPath(path)) return reply.code(404).send({ error: 'Nicht gefunden' });
    if (existsSync(CLIENT_DIST)) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Frontend nicht gebaut (npm run build)' });
  });

  return app;
}
