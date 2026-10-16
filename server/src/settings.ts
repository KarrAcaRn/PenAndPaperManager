import { normalizeUserSettings, type UserSettings } from '@pnp/shared';
import { getRow, parseJson, run, transaction, type Db } from './db.ts';

/** Einstellungen eines Benutzers, mit den Vorgaben zusammengeführt (auch ohne gespeicherte Zeile). */
export function getUserSettings(db: Db, userId: number): UserSettings {
  const row = getRow<{ data: string }>(db, 'SELECT data FROM user_settings WHERE user_id = ?', userId);
  return normalizeUserSettings(row ? parseJson<unknown>(row.data, {}) : {});
}

/** Übernimmt die angegebenen Einstellungen, die übrigen bleiben unverändert. Liefert den neuen Stand. */
export function updateUserSettings(db: Db, userId: number, changes: Partial<UserSettings>): UserSettings {
  return transaction(db, () => {
    const settings = normalizeUserSettings({ ...getUserSettings(db, userId), ...changes });
    run(
      db,
      `INSERT INTO user_settings (user_id, data) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
      userId,
      JSON.stringify(settings),
    );
    return settings;
  });
}
