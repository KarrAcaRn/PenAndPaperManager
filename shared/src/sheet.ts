import { hasControlChars, hasVisibleText, replaceControlChars } from './text.ts';
import type { Section } from './types.ts';

/** Bereiche, in denen Artikel einen FATE-Bogen haben können */
const SHEET_SECTIONS: readonly Section[] = ['characters', 'notes'];
export const canHaveSheet = (section: Section): boolean => SHEET_SECTIONS.includes(section);

export const STRESS_BOXES = 6;
/** Wie viele Stresskästchen je Leiste nutzbar sind (dunkel umrandet) - hängt von Fertigkeiten/Stunts ab */
export const MIN_STRESS_BOXES = 1;
export const DEFAULT_STRESS_BOXES = 4;
export const MAX_SKILLS = 40;
export const MAX_SKILL_NAME_LENGTH = 40;
export const MIN_SKILL_VALUE = -2;
export const MAX_SKILL_VALUE = 10;
export const MAX_SHEET_LINE_LENGTH = 300;
export const MAX_STUNTS_LENGTH = 5000;
export const MAX_PRESET_NAME_LENGTH = 80;
export const MAX_PRESET_DESCRIPTION_LENGTH = 500;

export const ASPECT_LABELS = {
  concept: 'Konzept',
  trouble: 'Dilemma',
  relationship: 'Beziehung',
  free1: 'Freier Aspekt',
  free2: 'Freier Aspekt',
} as const;
export type AspectKey = keyof typeof ASPECT_LABELS;

export const STRESS_LABELS = { physical: 'Körperlich', mental: 'Geistig' } as const;
export type StressKey = keyof typeof STRESS_LABELS;

/** Reihenfolge wie auf dem Bogen; die zweite leichte Konsequenz ist optional (ausgegraut) */
export const CONSEQUENCES = [
  { key: 'mild', label: 'Leicht', value: 2, optional: false },
  { key: 'moderate', label: 'Mittlere', value: 4, optional: false },
  { key: 'severe', label: 'Schwere', value: 6, optional: false },
  { key: 'mild2', label: 'Leicht', value: 2, optional: true },
] as const;
export type ConsequenceKey = (typeof CONSEQUENCES)[number]['key'];

export interface SheetData {
  name: string;
  age: string;
  pronouns: string;
  aspects: Record<AspectKey, string>;
  stunts: string;
  refresh: string;
  stress: Record<StressKey, boolean[]>;
  /** Anzahl nutzbarer Kästchen je Stressleiste (MIN_STRESS_BOXES bis STRESS_BOXES); die übrigen sind ausgegraut */
  stressBoxes: Record<StressKey, number>;
  consequences: Record<ConsequenceKey, string>;
  /** Wert je Fertigkeit, Schlüssel ist die ID der Gruppen-Fertigkeit */
  skills: Record<string, number>;
}

/** Gespeicherter Bogen. Die Version zählt bei jedem Speichern hoch und verhindert, dass zwei Bearbeiter sich überschreiben. */
export interface Sheet {
  data: SheetData;
  version: number;
}

/** Leerer Bogen; der Name wird üblicherweise mit dem Artikeltitel vorbelegt */
export function emptySheet(name = ''): SheetData {
  return {
    name,
    age: '',
    pronouns: '',
    aspects: { concept: '', trouble: '', relationship: '', free1: '', free2: '' },
    stunts: '',
    refresh: '3',
    stress: { physical: Array(STRESS_BOXES).fill(false), mental: Array(STRESS_BOXES).fill(false) },
    stressBoxes: { physical: DEFAULT_STRESS_BOXES, mental: DEFAULT_STRESS_BOXES },
    consequences: { mild: '', moderate: '', severe: '', mild2: '' },
    skills: {},
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Macht aus beliebigen gespeicherten Daten einen vollständigen Bogen: Fehlendes oder Unpassendes
 * (älterer Stand, Eingriff von Hand in die Datenbank) wird durch die Vorgabe ersetzt, einzeilige Felder
 * werden von Steuerzeichen befreit. Fertigkeitswerte prüft der Server gegen die Liste der Gruppe.
 */
export function normalizeSheet(raw: unknown): SheetData {
  const sheet = emptySheet();
  if (!isRecord(raw)) return sheet;

  const line = (value: unknown, fallback: string) => (typeof value === 'string' ? replaceControlChars(value) : fallback);
  const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);
  const group = <K extends string>(target: Record<K, string>, source: unknown, read: typeof line) => {
    if (!isRecord(source)) return;
    for (const key of Object.keys(target) as K[]) target[key] = read(source[key], target[key]);
  };

  sheet.name = line(raw.name, sheet.name);
  sheet.age = line(raw.age, sheet.age);
  sheet.pronouns = line(raw.pronouns, sheet.pronouns);
  sheet.refresh = line(raw.refresh, sheet.refresh);
  sheet.stunts = text(raw.stunts, sheet.stunts);
  group(sheet.aspects, raw.aspects, text);
  group(sheet.consequences, raw.consequences, line);
  if (isRecord(raw.stress)) {
    for (const key of Object.keys(sheet.stress) as StressKey[]) {
      const boxes = raw.stress[key];
      if (Array.isArray(boxes)) sheet.stress[key] = sheet.stress[key].map((_, i) => boxes[i] === true);
    }
  }
  if (isRecord(raw.stressBoxes)) {
    for (const key of Object.keys(sheet.stressBoxes) as StressKey[]) {
      const count = raw.stressBoxes[key];
      if (Number.isInteger(count) && (count as number) >= MIN_STRESS_BOXES && (count as number) <= STRESS_BOXES) {
        sheet.stressBoxes[key] = count as number;
      }
    }
  }
  if (isRecord(raw.skills)) {
    for (const [id, value] of Object.entries(raw.skills)) {
      if (Number.isInteger(value)) sheet.skills[id] = value as number;
    }
  }
  return sheet;
}

/** Fertigkeit einer Gruppe */
export interface Skill {
  id: number;
  name: string;
}

/** Eintrag beim Speichern der Liste: mit id = bestehende Fertigkeit (umbenennen/umsortieren), ohne = neu */
export interface SkillInput {
  id?: number;
  name: string;
}

/** Default-Zusammenstellung von Fertigkeiten, die der Spielleiter übernehmen kann */
export interface SkillPreset {
  id: number;
  name: string;
  description: string;
  skills: string[];
}
export type SkillPresetInput = Omit<SkillPreset, 'id'>;

/** Variante, die beim Anlegen einer Gruppe vorausgewählt ist (sofern der Admin sie nicht umbenannt hat) */
export const DEFAULT_PRESET_NAME = 'Fate Core';

export class SkillListError extends Error {}

/** Schlüssel, unter dem zwei Fertigkeitsnamen als gleich gelten (Groß-/Kleinschreibung egal) */
export const skillKey = (name: string): string => name.toLocaleLowerCase('de');

/**
 * Bringt Fertigkeitsnamen in kanonische Form (getrimmt, NFC) und prüft die Liste.
 * Wirft SkillListError bei leeren/unsichtbaren Namen, Duplikaten oder zu langen Listen.
 */
export function normalizeSkillNames(names: readonly string[]): string[] {
  if (names.length > MAX_SKILLS) throw new SkillListError(`Höchstens ${MAX_SKILLS} Fertigkeiten`);
  const seen = new Set<string>();
  return names.map((raw) => {
    const name = raw.normalize('NFC').trim();
    if (!hasVisibleText(name)) throw new SkillListError('Fertigkeiten brauchen einen Namen');
    if (hasControlChars(name)) throw new SkillListError(`"${name}" enthält ungültige Zeichen`);
    if (name.length > MAX_SKILL_NAME_LENGTH) {
      throw new SkillListError(`"${name}" ist zu lang (max. ${MAX_SKILL_NAME_LENGTH} Zeichen)`);
    }
    const key = skillKey(name);
    if (seen.has(key)) throw new SkillListError(`"${name}" kommt doppelt vor`);
    seen.add(key);
    return name;
  });
}
