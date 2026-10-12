-- Grundschema. Bis zum ersten Produktivbetrieb aus den früheren Migrationen zusammengefasst;
-- Änderungen ab jetzt nur noch als neue Migration (002_…), diese Datei nicht mehr ändern.

CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE groups (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE memberships (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('gm', 'player')),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX memberships_user ON memberships(user_id);

-- Ordner je Gruppe und Bereich als Baum. Alle, die den Bereich sehen, sehen auch alle Ordner darin;
-- ein- und ausgeblendet werden nur Artikel (Sichtbarkeit).
-- Umbenennen/Verschieben ändert nur die eigene Zeile, Artikel und Unterordner hängen an der ID.
CREATE TABLE folders (
  id         INTEGER PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  section    TEXT NOT NULL CHECK (section IN ('characters', 'notes', 'gm')),
  -- NULL = oberste Ebene des Bereichs; der Elternordner liegt in derselben Gruppe und demselben Bereich
  parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (name <> ''),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Namen sind je Elternordner eindeutig (COALESCE, weil NULLs in UNIQUE nie gleich sind)
CREATE UNIQUE INDEX folders_name ON folders(group_id, section, COALESCE(parent_id, 0), name);
CREATE INDEX folders_parent ON folders(parent_id);

-- Vollständiger Pfad ("bar/foo") je Ordner, wie ihn API und Client verwenden
CREATE VIEW folder_paths AS
WITH RECURSIVE fp(id, path) AS (
  SELECT id, name FROM folders WHERE parent_id IS NULL
  UNION ALL
  SELECT f.id, fp.path || '/' || f.name FROM folders f JOIN fp ON f.parent_id = fp.id
)
SELECT id, path FROM fp;

CREATE TABLE articles (
  id         INTEGER PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  section    TEXT NOT NULL CHECK (section IN ('characters', 'notes', 'gm')),
  -- NULL = oberste Ebene; der Ordner liegt in derselben Gruppe und demselben Bereich (prüft der Server)
  folder_id  INTEGER REFERENCES folders(id),
  title      TEXT NOT NULL,
  body_md    TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'private_gm', 'public')),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX articles_location ON articles(group_id, section, folder_id);
CREATE INDEX articles_folder ON articles(folder_id);

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

-- FATE-Bogen eines Artikels (nur Bereiche characters/notes).
-- data (SheetData, JSON) wird im Bearbeiten-Modus gepflegt, state (SheetState, JSON: Stress, Konsequenztexte)
-- auch im Spiel. Getrennte Versionen, damit sich beides nicht gegenseitig als Konflikt meldet.
-- format: Aufbau von data/state; ändert er sich, wandelt der Server ältere Formate beim Lesen um.
CREATE TABLE character_sheets (
  article_id    INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  format        INTEGER NOT NULL DEFAULT 1,
  data          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  state         TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Merker für einmalige Aktionen beim Start (z.B. Default-Varianten eingespielt)
CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Regelwerke (PDF): die Datei liegt im Dateisystem (data/rulebooks/<id>.pdf), der Text seitenweise hier.
CREATE TABLE rulebooks (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL UNIQUE,
  page_count    INTEGER NOT NULL,
  chapters_json TEXT NOT NULL DEFAULT '[]',
  imported_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rulebook_pages (
  id          INTEGER PRIMARY KEY,
  rulebook_id INTEGER NOT NULL REFERENCES rulebooks (id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  label       TEXT NOT NULL,
  chapter     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL,
  UNIQUE (rulebook_id, page)
);

-- Volltextindex über Kapitel und Text; remove_diacritics 2 findet "uberwinden" auch bei "überwinden".
CREATE VIRTUAL TABLE rulebook_search USING fts5(
  chapter, body,
  content = 'rulebook_pages', content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER rulebook_pages_ai AFTER INSERT ON rulebook_pages BEGIN
  INSERT INTO rulebook_search (rowid, chapter, body) VALUES (new.id, new.chapter, new.body);
END;

CREATE TRIGGER rulebook_pages_ad AFTER DELETE ON rulebook_pages BEGIN
  INSERT INTO rulebook_search (rulebook_search, rowid, chapter, body) VALUES ('delete', old.id, old.chapter, old.body);
END;

CREATE TRIGGER rulebook_pages_au AFTER UPDATE ON rulebook_pages BEGIN
  INSERT INTO rulebook_search (rulebook_search, rowid, chapter, body) VALUES ('delete', old.id, old.chapter, old.body);
  INSERT INTO rulebook_search (rowid, chapter, body) VALUES (new.id, new.chapter, new.body);
END;
