import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
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
import { themeRoutes } from './routes/themes.ts';
import { apiPath, parseAdminEmails, requireAuthForApi } from './auth.ts';
import { seedPresets } from './presets.ts';
import { builtinThemesDir, dbPath, rulebookDir, themesDir } from './paths.ts';
import { createThemeRegistry, defaultThemeId } from './themes.ts';
import { BASE_THEME_ID } from '@pnp/shared';

const CLIENT_DIST = join(import.meta.dirname, '../../client/dist');

export interface AppOptions {
  logger?: boolean;
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
}

export function buildApp(db: Db, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
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

  // Produktion: gebautes Frontend ausliefern (im Dev-Betrieb übernimmt das Vite).
  if (existsSync(CLIENT_DIST)) {
    app.register(fastifyStatic, { root: CLIENT_DIST });
  }
  app.setNotFoundHandler((req, reply) => {
    if (apiPath(req).startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    if (existsSync(CLIENT_DIST)) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Frontend nicht gebaut (npm run build)' });
  });

  return app;
}
