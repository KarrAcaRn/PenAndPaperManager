-- Bereiche "NPCs" und "Orte" zum Bereich "Notizen" zusammenfassen.
-- Bestehende Inhalte wandern dort in die Ordner "NPCs" bzw. "Orte", damit nichts kollidiert.
-- SQLite kann CHECK-Bedingungen nicht ändern, daher werden beide Tabellen neu aufgebaut.

CREATE TABLE articles_new (
  id         INTEGER PRIMARY KEY,
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  section    TEXT NOT NULL CHECK (section IN ('characters', 'notes', 'gm')),
  path       TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL,
  body_md    TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'private_gm', 'public')),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO articles_new (id, group_id, section, path, title, body_md, visibility, author_id, created_at, updated_at)
SELECT
  id,
  group_id,
  CASE WHEN section IN ('npcs', 'locations') THEN 'notes' ELSE section END,
  CASE section
    WHEN 'npcs' THEN 'NPCs' || CASE WHEN path = '' THEN '' ELSE '/' || path END
    WHEN 'locations' THEN 'Orte' || CASE WHEN path = '' THEN '' ELSE '/' || path END
    ELSE path
  END,
  title, body_md, visibility, author_id, created_at, updated_at
FROM articles;

DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;
CREATE INDEX articles_location ON articles(group_id, section, path);

CREATE TABLE folders_new (
  group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  section    TEXT NOT NULL CHECK (section IN ('characters', 'notes', 'gm')),
  path       TEXT NOT NULL CHECK (path <> ''),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (group_id, section, path)
);

INSERT INTO folders_new (group_id, section, path, created_by, created_at)
SELECT
  group_id,
  CASE WHEN section IN ('npcs', 'locations') THEN 'notes' ELSE section END,
  CASE section WHEN 'npcs' THEN 'NPCs/' || path WHEN 'locations' THEN 'Orte/' || path ELSE path END,
  created_by, created_at
FROM folders;

-- Invariante: zu jedem Ordner existieren alle Elternordner – also auch "NPCs" bzw. "Orte" selbst.
-- Angelegt vom Ersteller des ältesten Ordners, damit derjenige ihn auch verwalten kann.
INSERT INTO folders_new (group_id, section, path, created_by, created_at)
SELECT f.group_id, 'notes', CASE f.section WHEN 'npcs' THEN 'NPCs' ELSE 'Orte' END, f.created_by, f.created_at
FROM folders f
WHERE f.section IN ('npcs', 'locations')
  AND f.rowid = (
    SELECT g.rowid FROM folders g
    WHERE g.group_id = f.group_id AND g.section = f.section
    ORDER BY g.created_at, g.rowid
    LIMIT 1
  );

DROP TABLE folders;
ALTER TABLE folders_new RENAME TO folders;
