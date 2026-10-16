import type { FastifyInstance } from 'fastify';
import { USER_SETTING_KEYS, USER_SETTING_OPTIONS, type UserSettings } from '@pnp/shared';
import type { Db } from '../db.ts';
import { requireUser } from '../auth.ts';
import { getUserSettings, updateUserSettings } from '../settings.ts';
import { objectOf } from '../schemas.ts';

/** Teiländerung: jede Einstellung optional, nur erlaubte Werte (sonst 400). */
const settingsPatchBody = objectOf(
  Object.fromEntries(USER_SETTING_KEYS.map((key) => [key, { enum: USER_SETTING_OPTIONS[key] }])),
  [],
);

/** Immer nur die Einstellungen des eingeloggten Benutzers – es gibt keine Route mit fremder Benutzer-ID. */
export function settingsRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/me/settings', (req) => getUserSettings(db, requireUser(db, req).id));

  app.patch('/api/me/settings', { schema: { body: settingsPatchBody } }, (req) =>
    updateUserSettings(db, requireUser(db, req).id, req.body as Partial<UserSettings>),
  );
}
