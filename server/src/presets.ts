import type { SkillPreset, SkillPresetInput } from '@pnp/shared';
import { allRows, getRow, insertRow, parseJson, run, transaction, type Db } from './db.ts';
import { conflict, notFound } from './errors.ts';
import { DEFAULT_PRESETS } from './presets/defaults.ts';

// Die Fertigkeiten liegen als JSON-Array in einer Spalte - dieses Detail kennt nur dieses Modul.
type PresetRow = Omit<SkillPreset, 'skills'> & { skills: string };

const COLUMNS = 'id, name, description, skills';
const presetNotFound = () => notFound('Variante nicht gefunden');
function fromRow(row: PresetRow): SkillPreset {
  // Nach einem Eingriff von Hand kann hier alles Mögliche stehen - dann gilt die Variante als leer.
  const skills = parseJson<unknown>(row.skills, []);
  const valid = Array.isArray(skills) && skills.every((skill) => typeof skill === 'string');
  return { ...row, skills: valid ? skills : [] };
}

export function listPresets(db: Db): SkillPreset[] {
  return allRows<PresetRow>(db, `SELECT ${COLUMNS} FROM skill_presets ORDER BY name COLLATE NOCASE`).map(fromRow);
}

export function loadPreset(db: Db, id: number): SkillPreset {
  const row = getRow<PresetRow>(db, `SELECT ${COLUMNS} FROM skill_presets WHERE id = ?`, id);
  if (!row) throw presetNotFound();
  return fromRow(row);
}

/** Für "Variante übernehmen": Eine leere (oder beschädigte) Variante würde alle Fertigkeiten der Gruppe löschen. */
export function loadUsablePreset(db: Db, id: number): SkillPreset {
  const preset = loadPreset(db, id);
  if (preset.skills.length === 0) throw conflict('Diese Variante enthält keine Fertigkeiten');
  return preset;
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
  assertNameFree(db, preset.name, id);
  const updated = run(
    db,
    `UPDATE skill_presets SET name = ?, description = ?, skills = ?, updated_at = datetime('now') WHERE id = ?`,
    preset.name,
    preset.description,
    JSON.stringify(preset.skills),
    id,
  );
  if (!updated) throw presetNotFound();
  return { id, ...preset };
}

export function deletePreset(db: Db, id: number): void {
  if (!run(db, 'DELETE FROM skill_presets WHERE id = ?', id)) throw presetNotFound();
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
