-- Soundboard: externe Speicher der Nutzer (S3, Google Drive, …), siehe docs/soundboard-storage.md.
-- Ein Nutzer kann mehrere Verbindungen haben. provider_type ohne CHECK, damit neue Anbieter keine
-- Tabellen-Neuanlage brauchen; gültige Werte prüft der Server (STORAGE_PROVIDER_TYPES in shared).
CREATE TABLE user_storage_connections (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_type  TEXT NOT NULL,
  display_name   TEXT NOT NULL CHECK (display_name <> ''),
  -- nicht geheime Einstellungen als JSON-Objekt (Bucket, Region, Prefix, Drive-Ordner-ID)
  config         TEXT NOT NULL DEFAULT '{}',
  -- Zugangsdaten/Tokens als JSON, mit AES-256-GCM verschlüsselt (server/src/secrets.ts); nie im Klartext
  credentials    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'disconnected')),
  status_message TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX user_storage_connections_user ON user_storage_connections(user_id);
