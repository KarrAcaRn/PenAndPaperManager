-- Default-Zusammenstellungen von Fertigkeiten (Admin-Bereich); skills ist ein JSON-Array von Namen
CREATE TABLE skill_presets (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  skills      TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Fertigkeiten einer Gruppe. Eigene IDs, damit Umbenennen die Werte auf den Bögen behält.
-- AUTOINCREMENT: IDs gelöschter Fertigkeiten dürfen nie wiederverwendet werden, sonst würden alte
-- Werte auf den Bögen plötzlich zu einer neuen Fertigkeit gehören.
CREATE TABLE group_skills (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name     TEXT NOT NULL COLLATE NOCASE,
  position INTEGER NOT NULL,
  -- nur Sicherheitsnetz (NOCASE kennt nur ASCII); die eigentliche Prüfung macht normalizeSkillNames
  UNIQUE (group_id, name)
);

-- FATE-Bogen eines Artikels (nur Bereiche characters/notes); data ist JSON (SheetData)
CREATE TABLE character_sheets (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Merker für einmalige Aktionen beim Start (z.B. Default-Varianten eingespielt)
CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
