import type { FastifyInstance } from 'fastify';
import { USER_SETTING_KEYS, USER_SETTINGS, type UserSettings } from '@pnp/shared';
import type { Db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { badRequest } from '../errors.ts';
import { getUserSettings, updateUserSettings } from '../settings.ts';
import { objectOf } from '../schemas.ts';
import type { ThemeRegistry } from '../themes.ts';

/** Teiländerung: jede Einstellung optional, nur erlaubte Werte (sonst 400). */
const settingsPatchBody = objectOf(Object.fromEntries(USER_SETTING_KEYS.map((key) => [key, USER_SETTINGS[key].schema])), []);

/**
 * Immer nur die Einstellungen des eingeloggten Benutzers – es gibt keine Route mit fremder Benutzer-ID.
 * Ein gewähltes Theme, das es nicht mehr gibt, wird als null (Vorgabe der Seite) gemeldet; gespeichert bleibt es,
 * damit es wieder greift, falls der Seitenbetreiber es zurücklegt.
 */
export function settingsRoutes(app: FastifyInstance, db: Db, themes: Pick<ThemeRegistry, 'getTheme'>): void {
  const withExistingTheme = (settings: UserSettings): UserSettings =>
    settings.theme !== null && !themes.getTheme(settings.theme) ? { ...settings, theme: null } : settings;

  app.get('/api/me/settings', (req) => withExistingTheme(getUserSettings(db, requireUser(db, req).id)));

  app.patch('/api/me/settings', { schema: { body: settingsPatchBody } }, (req) => {
    const user = requireUser(db, req);
    const changes = req.body as Partial<UserSettings>;
    if (changes.theme && !themes.getTheme(changes.theme)) throw badRequest(`Das Theme „${changes.theme}“ gibt es nicht.`);
    return withExistingTheme(updateUserSettings(db, user.id, changes));
  });
}
