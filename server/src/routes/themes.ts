import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_THEME_ID, SITE_DEFAULT_STYLESHEET, THEME_ID_PATTERN, themeStylesheetUrl } from '@pnp/shared';
import { notFound } from '../errors.ts';
import { objectOf } from '../schemas.ts';
import { STYLESHEET_FILE, themeAsset, type Theme, type ThemeRegistry } from '../themes.ts';

const themeParams = objectOf({ id: { type: 'string', pattern: THEME_ID_PATTERN } });
const fileParams = objectOf({ id: { type: 'string', pattern: THEME_ID_PATTERN }, '*': { type: 'string', maxLength: 300 } });

/** API-Form eines Themes: ohne Ordner, Zusatz-CSS und erzeugtes Stylesheet */
const toInfo = ({ dir: _dir, extraCss: _extra, css: _css, etag: _etag, ...info }: Theme) => info;

/** If-None-Match: Liste, „*“ und schwache ETags (W/…, z.B. nach gzip durch einen Proxy) berücksichtigen */
const etagMatches = (header: string | undefined, etag: string) =>
  !!header && header.split(',').some((t) => t.trim() === '*' || t.trim().replace(/^W\//, '') === etag);

/** Themes können sich ohne Neustart ändern: immer nachfragen, unverändert gibt es 304 */
function revalidate(req: FastifyRequest, reply: FastifyReply, etag: string, type: string): boolean {
  reply.header('Cache-Control', 'no-cache').header('ETag', etag).type(type);
  if (!etagMatches(req.headers['if-none-match'], etag)) return false;
  reply.code(304).send();
  return true;
}

/**
 * Themes sind öffentlich (auch die Anmeldeseite ist gestaltet). Die erzeugten Stylesheets und Theme-Dateien liegen
 * außerhalb von /api unter /themes/<id>/, damit relative url(…) im Zusatz-CSS auf die Dateien des Themes zeigen.
 */
export function themeRoutes(app: FastifyInstance, registry: ThemeRegistry, defaultTheme: () => string = () => BASE_THEME_ID): void {
  function getTheme(id: string): Theme {
    const theme = registry.getTheme(id);
    if (!theme) throw notFound(`Theme „${id}“ nicht gefunden`);
    return theme;
  }

  /** defaultTheme: Theme für alle ohne eigene Wahl (DEFAULT_THEME des Seitenbetreibers, sonst „default“) */
  app.get('/api/themes', () => ({ themes: registry.listThemes().map(toInfo), defaultTheme: defaultTheme() }));

  // Weiterleitung statt Inhalt: relative url(…) im Zusatz-CSS lösen so gegen den Ordner des Themes auf
  app.get(SITE_DEFAULT_STYLESHEET, (_req, reply) =>
    reply.header('Cache-Control', 'no-cache').redirect(themeStylesheetUrl(defaultTheme()), 302),
  );

  app.get('/api/themes/:id', { schema: { params: themeParams } }, (req) => ({
    theme: toInfo(getTheme((req.params as { id: string }).id)),
  }));

  app.get(`/themes/:id/${STYLESHEET_FILE}`, { schema: { params: themeParams } }, (req, reply) => {
    const theme = getTheme((req.params as { id: string }).id);
    if (revalidate(req, reply, theme.etag, 'text/css; charset=utf-8')) return reply;
    return reply.send(theme.css);
  });

  app.get('/themes/:id/*', { schema: { params: fileParams } }, (req, reply) => {
    const { id, '*': rel } = req.params as { id: string; '*': string };
    const asset = themeAsset(getTheme(id), rel);
    if (!asset) throw notFound('Datei nicht gefunden');
    if (revalidate(req, reply, asset.etag, asset.type)) return reply;
    return reply.send(createReadStream(asset.path));
  });
}
