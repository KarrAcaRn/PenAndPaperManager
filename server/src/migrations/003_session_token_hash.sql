-- Sessions speichern nur noch den SHA-256-Hash des Tokens, damit ein Datenbank-Leak keine gültigen Cookies verrät.
-- Bestehende Sessions (Klartext-Token) lassen sich nicht umrechnen und werden verworfen: alle müssen sich neu einloggen.
DROP TABLE sessions;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- absolute Ablaufzeit (höchstens 30 Tage nach dem Login), wird nie verlängert
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);
