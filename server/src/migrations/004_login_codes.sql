-- Einmal-Codes für den Login per E-Mail. Gespeichert wird nur ein gesalzener scrypt-Hash, nie der Code selbst.
-- Zeilen bleiben nach Verbrauch/Ablauf noch einen Tag stehen, weil das Rate-Limiting über sie zählt.
CREATE TABLE login_codes (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL COLLATE NOCASE,
  code_salt       TEXT NOT NULL,
  code_hash       TEXT NOT NULL,
  ip              TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  -- erfolgreich eingelöst
  consumed_at     TEXT,
  -- durch einen neueren Code derselben Adresse ersetzt
  invalidated_at  TEXT
);
CREATE INDEX login_codes_email ON login_codes(email, created_at);
CREATE INDEX login_codes_ip ON login_codes(ip, created_at);
