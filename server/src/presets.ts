import type { SkillPreset, SkillPresetInput } from '@pnp/shared';
import { allRows, getRow, insertRow, parseJson, run, transaction, type Db } from './db.ts';
import { conflict, notFound } from './errors.ts';
import { DEFAULT_PRESETS } from './presets/defaults.ts';

// Die Fertigkeiten liegen als JSON-Array in einer Spalte - dieses Detail kennt nur dieses Modul.
type PresetRow = Omit<SkillPreset, 'skills'> & { skills: string };

const COLUMNS = 'id, name, description, skills';
const fromRow = (row: PresetRow): SkillPreset => ({ ...row, skills: parseJson<string[]>(row.skills, []) });

export function listPresets(db: Db): SkillPreset[] {
  return allRows<PresetRow>(db, `SELECT ${COLUMNS} FROM skill_presets ORDER BY name COLLATE NOCASE`).map(fromRow);
}

export function loadPreset(db: Db, id: number): SkillPreset {
  const row = getRow<PresetRow>(db, `SELECT ${COLUMNS} FROM skill_presets WHERE id = ?`, id);
  if (!row) throw notFound('Variante nicht gefunden');
  return fromRow(row);
}

function assertNameFree(db: Db, name: string, exceptId?: number): void {
  const taken = getRow<{ id: number }>(db, 'SELECT id FROM skill_presets WHERE name = ?', name);
  if (taken && taken.id !== exceptId) throw conflict('Es gibt bereits eine Variante mit diesem Namen');
}

export function insertPreset(db: Db, preset: SkillPresetInput): SkillPreset {
  assertNameFree(db, preset.name);
  const id = insertRow(
    db,
    'INSERT INTO skill_presets (name, description, skills) VALUES (?, ?, ?)',
    preset.name,
    preset.description,
    JSON.stringify(preset.skills),
  );
  return { id, ...preset };
}

export function updatePreset(db: Db, id: number, preset: SkillPresetInput): SkillPreset {
  loadPreset(db, id);
  assertNameFree(db, preset.name, id);
  run(
    db,
    `UPDATE skill_presets SET name = ?, description = ?, skills = ?, updated_at = datetime('now') WHERE id = ?`,
    preset.name,
    preset.description,
    JSON.stringify(preset.skills),
    id,
  );
  return { id, ...preset };
}

export function deletePreset(db: Db, id: number): void {
  loadPreset(db, id);
  run(db, 'DELETE FROM skill_presets WHERE id = ?', id);
}

/**
 * Spielt die Default-Varianten genau einmal ein. Der Merker verhindert, dass vom Admin gelöschte
 * oder geänderte Varianten beim nächsten Start zurückkommen.
 */
export function seedPresets(db: Db): void {
  transaction(db, () => {
    if (getRow(db, `SELECT 1 FROM app_state WHERE key = 'presets_seeded'`)) return;
    for (const preset of DEFAULT_PRESETS) insertPreset(db, preset);
    run(db, `INSERT INTO app_state (key, value) VALUES ('presets_seeded', datetime('now'))`);
  });
}
