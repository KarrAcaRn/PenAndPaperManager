import { normalizePath, PathError, type Section } from '@pnp/shared';
import { allRows, getRow, insertRow, type Db } from './db.ts';
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

export interface FolderWithPath {
  id: number;
  path: string;
  createdBy: number;
}

/**
 * Alle Ordner eines Bereichs mit vollständigem Pfad. Eine Abfrage über den Index (group_id, section), die Pfade
 * setzt JS aus parent_id zusammen - ein rekursives SQL-View würde für jede Abfrage alle Gruppen durchlaufen.
 */
export function listFolders(db: Db, groupId: number, section: Section): FolderWithPath[] {
  const rows = allRows<{ id: number; parentId: number | null; name: string; createdBy: number }>(
    db,
    'SELECT id, parent_id AS parentId, name, created_by AS createdBy FROM folders WHERE group_id = ? AND section = ?',
    groupId,
    section,
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths = new Map<number, string>();
  const pathOf = (id: number): string => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const row = byId.get(id)!;
    // Elternordner liegt immer im selben Bereich (sonst wäre er nicht in byId) - zur Sicherheit oberste Ebene
    const parent = row.parentId !== null && byId.has(row.parentId) ? `${pathOf(row.parentId)}/` : '';
    const path = parent + row.name;
    paths.set(id, path);
    return path;
  };
  return rows.map(({ id, createdBy }) => ({ id, path: pathOf(id), createdBy }));
}

/** Pfad je Ordner-ID eines Bereichs; für Artikel ohne Ordner (null) '' */
export function folderPathLookup(db: Db, groupId: number, section: Section): (folderId: number | null) => string {
  const paths = new Map(listFolders(db, groupId, section).map((f) => [f.id, f.path]));
  return (folderId) => (folderId === null ? '' : (paths.get(folderId) ?? ''));
}

/** Pfad eines einzelnen Ordners (geht die Elternordner per Primärschlüssel hoch); null = oberste Ebene ('') */
export function folderPath(db: Db, folderId: number | null): string {
  const names: string[] = [];
  for (let id = folderId; id !== null; ) {
    const row = getRow<{ parentId: number | null; name: string }>(db, 'SELECT parent_id AS parentId, name FROM folders WHERE id = ?', id);
    if (!row) break;
    names.unshift(row.name);
    id = row.parentId;
  }
  return names.join('/');
}

/** Unterordner mit diesem Namen; parentId null = oberste Ebene. Nutzt den Index folders_name (daher COALESCE). */
function childFolderId(db: Db, groupId: number, section: Section, parentId: number | null, name: string): number | undefined {
  return getRow<{ id: number }>(
    db,
    'SELECT id FROM folders WHERE group_id = ? AND section = ? AND COALESCE(parent_id, 0) = ? AND name = ?',
    groupId,
    section,
    parentId ?? 0,
    name,
  )?.id;
}

/** ID des Ordners mit diesem (normalisierten) Pfad; '' ist die oberste Ebene (null), undefined = gibt es nicht */
export function findFolderId(db: Db, groupId: number, section: Section, path: string): number | null | undefined {
  let id: number | null = null;
  for (const name of path === '' ? [] : path.split('/')) {
    const child = childFolderId(db, groupId, section, id, name);
    if (child === undefined) return undefined;
    id = child;
  }
  return id;
}

/**
 * ID des Ordners mit diesem (normalisierten) Pfad; fehlende Ordner auf dem Weg werden angelegt.
 * '' ist die oberste Ebene (null). Muss in einer Transaktion laufen.
 */
export function ensureFolderPath(db: Db, groupId: number, section: Section, path: string, userId: number): number | null {
  let parentId: number | null = null;
  for (const name of path === '' ? [] : path.split('/')) {
    parentId =
      childFolderId(db, groupId, section, parentId, name) ??
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
