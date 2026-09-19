import { SkillListError, normalizeSkillNames, skillKey, type Skill, type SkillInput } from '@pnp/shared';
import { allRows, insertRow, run, type Db } from './db.ts';
import { badRequest } from './errors.ts';

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
 * Ersetzt die Fertigkeitsliste einer Gruppe (innerhalb einer Transaktion aufrufen).
 * Einträge mit id behalten ihre ID - und damit die Werte auf den Bögen -, fehlende werden gelöscht.
 */
export function replaceGroupSkills(db: Db, groupId: number, items: readonly SkillInput[]): Skill[] {
  const names = parseSkillNames(items.map((item) => item.name));
  const existing = new Set(listGroupSkills(db, groupId).map((skill) => skill.id));
  const kept = new Set<number>();
  for (const { id } of items) {
    if (id === undefined) continue;
    if (!existing.has(id)) throw badRequest('Unbekannte Fertigkeit - bitte die Liste neu laden');
    if (kept.has(id)) throw badRequest('Eine Fertigkeit kommt doppelt vor');
    kept.add(id);
  }

  for (const id of existing) {
    if (!kept.has(id)) run(db, 'DELETE FROM group_skills WHERE id = ?', id);
  }
  // Namen erst freiräumen, damit Tauschen (A<->B) nicht an UNIQUE(group_id, name) scheitert.
  // \u0001 kann in gültigen Namen nicht vorkommen.
  run(db, `UPDATE group_skills SET name = char(1) || id WHERE group_id = ?`, groupId);
  items.forEach(({ id }, position) => {
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
  const idByName = new Map(listGroupSkills(db, groupId).map((skill) => [skillKey(skill.name), skill.id]));
  return replaceGroupSkills(
    db,
    groupId,
    parseSkillNames(names).map((name) => ({ id: idByName.get(skillKey(name)), name })),
  );
}
