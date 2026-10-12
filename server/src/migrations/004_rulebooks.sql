-- Regelwerke (PDF): die Datei liegt im Dateisystem (data/rulebooks/<id>.pdf), der Text seitenweise hier.
CREATE TABLE rulebooks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL UNIQUE,
  page_count INTEGER NOT NULL,
  chapters_json TEXT NOT NULL DEFAULT '[]',
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rulebook_pages (
  id INTEGER PRIMARY KEY,
  rulebook_id INTEGER NOT NULL REFERENCES rulebooks (id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  label TEXT NOT NULL,
  chapter TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
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
