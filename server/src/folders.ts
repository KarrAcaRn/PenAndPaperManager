import { normalizePath, PathError, pathPrefixes, type Section } from '@pnp/shared';
import { run, type Db } from './db.ts';
import { badRequest } from './errors.ts';

/** normalizePath mit 400 statt PathError */
export function parsePath(input: string): string {
  try {
    return normalizePath(input);
  } catch (err) {
    if (err instanceof PathError) throw badRequest(err.message);
    throw err;
  }
}

/** Wie parsePath, aber die Wurzel ('') ist kein gültiger Ordner. */
export function parseFolderPath(input: string): string {
  const path = parsePath(input);
  if (path === '') throw badRequest('Ordnername fehlt');
  return path;
}

/** Legt den Ordner samt fehlender Elternordner an (Invariante der Tabelle folders). */
export function ensureFolders(db: Db, groupId: number, section: Section, path: string, userId: number): void {
  for (const prefix of pathPrefixes(path)) {
    run(
      db,
      'INSERT INTO folders (group_id, section, path, created_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      groupId,
      section,
      prefix,
      userId,
    );
  }
}

/** SQL-Bedingung "gehört zu Gruppe :gid und Bereich :section" */
export const IN_SECTION_SQL = 'group_id = :gid AND section = :section';

/**
 * SQL-Bedingung "Spalte liegt in oder unter :path". Bewusst ohne LIKE,
 * damit % und _ in Ordnernamen nichts anrichten.
 */
export const withinSql = (column: string) =>
  `(${column} = :path OR substr(${column}, 1, length(:path) + 1) = :path || '/')`;
