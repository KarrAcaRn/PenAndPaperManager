import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { THEME_ID_PATTERN } from '@pnp/shared';
import { notFound } from '../errors.ts';
import { objectOf } from '../schemas.ts';
import { STYLESHEET_FILE, themeAsset, type Theme, type ThemeRegistry } from '../themes.ts';

const themeParams = objectOf({ id: { type: 'string', pattern: THEME_ID_PATTERN } });
const fileParams = objectOf({ id: { type: 'string', pattern: THEME_ID_PATTERN }, '*': { type: 'string', maxLength: 300 } });

/** API-Form eines Themes: ohne Ordner und Zusatz-CSS */
const toInfo = ({ dir: _dir, extraCss: _css, ...info }: Theme) => info;

/**
 * Themes sind öffentlich (auch die Anmeldeseite ist gestaltet). Die erzeugten Stylesheets und Theme-Dateien liegen
 * außerhalb von /api unter /themes/<id>/, damit relative url(…) im Zusatz-CSS auf die Dateien des Themes zeigen.
 */
export function themeRoutes(app: FastifyInstance, registry: ThemeRegistry): void {
  function getTheme(id: string): Theme {
    const theme = registry.getTheme(id);
    if (!theme) throw notFound(`Theme „${id}“ nicht gefunden`);
    return theme;
  }

  app.get('/api/themes', () => ({ themes: registry.listThemes().map(toInfo) }));

  app.get('/api/themes/:id', { schema: { params: themeParams } }, (req) => ({
    theme: toInfo(getTheme((req.params as { id: string }).id)),
  }));

  app.get(`/themes/:id/${STYLESHEET_FILE}`, { schema: { params: themeParams } }, (req, reply) => {
    const css = registry.stylesheet((req.params as { id: string }).id);
    if (css === undefined) throw notFound('Theme nicht gefunden');
    // Themes können sich ohne Neustart ändern – immer nachfragen
    return reply.type('text/css; charset=utf-8').header('Cache-Control', 'no-cache').send(css);
  });

  app.get('/themes/:id/*', { schema: { params: fileParams } }, (req, reply) => {
    const { id, '*': rel } = req.params as { id: string; '*': string };
    const asset = themeAsset(getTheme(id), rel);
    if (!asset) throw notFound('Datei nicht gefunden');
    return reply.type(asset.type).header('Cache-Control', 'no-cache').send(createReadStream(asset.path));
  });
}
