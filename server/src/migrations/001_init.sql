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

CREATE TABLE articles (
  id         INTEGER PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  section    TEXT NOT NULL CHECK (section IN ('characters', 'npcs', 'locations', 'gm')),
  path       TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL,
  body_md    TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'private_gm', 'public')),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX articles_location ON articles(group_id, section, path);

-- Explizit angelegte Ordner, damit auch leere Ordner bestehen bleiben.
-- Invariante: zu jedem Eintrag existieren auch alle Elternordner.
CREATE TABLE folders (
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  section    TEXT NOT NULL CHECK (section IN ('characters', 'npcs', 'locations', 'gm')),
  path       TEXT NOT NULL CHECK (path <> ''),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, section, path)
);
