-- Benutzereinstellungen (1:1 zum Benutzer). Als JSON-Objekt gespeichert, damit neue Einstellungen ohne
-- Schemaänderung hinzukommen; erlaubte Werte und Vorgaben stehen in shared/src/settings.ts.
-- Fehlt die Zeile, gelten die Vorgaben.
-- Rückbau (Migrationen laufen nur vorwärts): DROP TABLE user_settings; und den Eintrag in schema_migrations löschen.
CREATE TABLE user_settings (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data) AND json_type(data) = 'object'),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
