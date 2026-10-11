import { SkillListError, normalizeSkillNames, skillKey, type Skill, type SkillInput } from '@pnp/shared';
import { allRows, insertRow, run, type Db } from './db.ts';
import { badRequest, conflict } from './errors.ts';

/** normalizeSkillNames mit 400 statt SkillListError */
export function parseSkillNames(names: readonly string[]): string[] {
  try {
    return normalizeSkillNames(names);
  } catch (err) {
    if (err instanceof SkillListError) throw badRequest(err.message);
    throw err;
  }
}

export function listGroupSkills(db: Db, groupId: number): Skill[] {
  return allRows<Skill>(db, 'SELECT id, name FROM group_skills WHERE group_id = ? ORDER BY position', groupId);
}

/**
 * Bricht mit 409 ab, wenn die Liste nicht mehr dem Stand entspricht, von dem der Client ausging -
 * sonst überschriebe ein zweiter Spielleiter mit veralteter Seite still die Änderungen des ersten.
 */
export function assertSkillsUnchanged(db: Db, groupId: number, expected: readonly Skill[] | undefined): void {
  if (expected === undefined) return;
  const current = listGroupSkills(db, groupId);
  const same = current.length === expected.length && current.every((s, i) => s.id === expected[i].id && s.name === expected[i].name);
  if (!same) throw conflict('Die Fertigkeiten wurden inzwischen geändert - bitte die Seite neu laden');
}

/**
 * Ersetzt die Fertigkeitsliste einer Gruppe (innerhalb einer Transaktion aufrufen).
 * Einträge mit id behalten ihre ID - und damit die Werte auf den Bögen -, fehlende werden gelöscht.
 * Einträge ohne id übernehmen die ID einer gleichnamigen Fertigkeit, die sonst gelöscht würde: Wer eine
 * Fertigkeit entfernt und gleich wieder eintippt (oder eine Variante lädt), verliert so keine Werte.
 */
export function replaceGroupSkills(db: Db, groupId: number, items: readonly SkillInput[]): Skill[] {
  const names = parseSkillNames(items.map((item) => item.name));
  const existing = listGroupSkills(db, groupId);
  const existingIds = new Set(existing.map((skill) => skill.id));
  const kept = new Set<number>();
  for (const { id } of items) {
    if (id === undefined) continue;
    if (!existingIds.has(id)) throw badRequest('Unbekannte Fertigkeit - bitte die Liste neu laden');
    if (kept.has(id)) throw badRequest('Eine Fertigkeit kommt doppelt vor');
    kept.add(id);
  }
  const removedByKey = new Map(existing.filter((skill) => !kept.has(skill.id)).map((skill) => [skillKey(skill.name), skill.id]));
  const ids = items.map(({ id }, position) => {
    if (id !== undefined) return id;
    const reused = removedByKey.get(skillKey(names[position]));
    if (reused !== undefined) {
      removedByKey.delete(skillKey(names[position]));
      kept.add(reused);
    }
    return reused;
  });

  for (const id of existingIds) {
    if (!kept.has(id)) run(db, 'DELETE FROM group_skills WHERE id = ?', id);
  }
  // Namen erst freiräumen, damit Tauschen (A<->B) nicht an UNIQUE(group_id, name) scheitert.
  // \u0001 kann in gültigen Namen nicht vorkommen.
  run(db, `UPDATE group_skills SET name = char(1) || id WHERE group_id = ?`, groupId);
  ids.forEach((id, position) => {
    if (id === undefined) {
      insertRow(db, 'INSERT INTO group_skills (group_id, name, position) VALUES (?, ?, ?)', groupId, names[position], position);
    } else {
      run(db, 'UPDATE group_skills SET name = ?, position = ? WHERE id = ?', names[position], position, id);
    }
  });
  return listGroupSkills(db, groupId);
}

/** Übernimmt eine Namensliste (z.B. aus einer Variante); gleichnamige Fertigkeiten behalten ihre ID. */
export function applySkillNames(db: Db, groupId: number, names: readonly string[]): Skill[] {
  return replaceGroupSkills(db, groupId, names.map((name) => ({ name })));
}
