import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Db = DatabaseSync;

/** Positionsparameter oder genau ein Objekt mit benannten Parametern */
type SqlParams = SQLInputValue[] | [Record<string, SQLInputValue>];

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  // Server und Kommandozeilen-Skripte (import-rulebook) teilen sich die Datei: kurz auf Sperren warten statt abzubrechen
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY)');
  const applied = new Set(allRows<{ version: string }>(db, 'SELECT version FROM schema_migrations').map((r) => r.version));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    transaction(db, () => {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      run(db, 'INSERT INTO schema_migrations (version) VALUES (?)', file);
    });
  }
}

// Die einzigen Stellen, an denen untypisierte DB-Zeilen einen Typ bekommen.
export function getRow<T>(db: Db, sql: string, ...params: SqlParams): T | undefined {
  return db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
}

export function allRows<T>(db: Db, sql: string, ...params: SqlParams): T[] {
  return db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
}

/** Führt eine Anweisung aus und liefert die Zahl der geänderten Zeilen. */
export function run(db: Db, sql: string, ...params: SqlParams): number {
  return Number(db.prepare(sql).run(...(params as SQLInputValue[])).changes);
}

/** JSON aus einer Spalte lesen; ist es (z.B. nach einem Eingriff von Hand) kaputt, gilt der Ersatzwert statt eines 500ers. */
export function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Führt ein INSERT aus und liefert die neue ID. */
export function insertRow(db: Db, sql: string, ...params: SqlParams): number {
  return Number(db.prepare(sql).run(...(params as SQLInputValue[])).lastInsertRowid);
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
