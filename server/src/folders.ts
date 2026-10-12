import { normalizePath, PathError, type Section } from '@pnp/shared';
import { getRow, insertRow, type Db } from './db.ts';
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

/** SQL-Bedingung "gehört zu Gruppe :gid und Bereich :section"; die Parameter dazu liefert sectionParams() */
export const IN_SECTION_SQL = 'group_id = :gid AND section = :section';

export function sectionParams(groupId: number, section: Section): { gid: number; section: Section } {
  return { gid: groupId, section };
}

/** Ordner samt vollständigem Pfad (View folder_paths): Aliase "f" (folders) und "fp" (fp.path) */
export const FOLDERS_WITH_PATH = 'folders f JOIN folder_paths fp ON fp.id = f.id';

/** ID des Ordners mit diesem (normalisierten) Pfad; '' ist die oberste Ebene (null), undefined = gibt es nicht */
export function findFolderId(db: Db, groupId: number, section: Section, path: string): number | null | undefined {
  if (path === '') return null;
  return getRow<{ id: number }>(
    db,
    `SELECT f.id FROM ${FOLDERS_WITH_PATH} WHERE f.group_id = ? AND f.section = ? AND fp.path = ?`,
    groupId,
    section,
    path,
  )?.id;
}

/**
 * ID des Ordners mit diesem (normalisierten) Pfad; fehlende Ordner auf dem Weg werden angelegt.
 * '' ist die oberste Ebene (null). Muss in einer Transaktion laufen.
 */
export function ensureFolderPath(db: Db, groupId: number, section: Section, path: string, userId: number): number | null {
  let parentId: number | null = null;
  for (const name of path === '' ? [] : path.split('/')) {
    const existing: { id: number } | undefined = getRow<{ id: number }>(
      db,
      'SELECT id FROM folders WHERE group_id = ? AND section = ? AND parent_id IS ? AND name = ?',
      groupId,
      section,
      parentId,
      name,
    );
    parentId =
      existing?.id ??
      insertRow(
        db,
        'INSERT INTO folders (group_id, section, parent_id, name, created_by) VALUES (?, ?, ?, ?, ?)',
        groupId,
        section,
        parentId,
        name,
        userId,
      );
  }
  return parentId;
}
