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

/** Stufen einer Konsequenz: so viel Stress fängt sie ab */
export const CONSEQUENCE_VALUES = [2, 4, 6] as const;
export type ConsequenceValue = (typeof CONSEQUENCE_VALUES)[number];
export const CONSEQUENCE_LABELS: Record<ConsequenceValue, string> = { 2: 'Leicht', 4: 'Mittlere', 6: 'Schwere' };
/** Konsequenzen eines neuen Bogens; im Bearbeiten-Modus lassen sich Zeilen frei hinzufügen und entfernen */
export const DEFAULT_CONSEQUENCES: readonly ConsequenceValue[] = [2, 4, 6];
/** Mehr passen nicht auf die A4-Seite */
export const MAX_CONSEQUENCES = 6;
export const MAX_CONSEQUENCE_KEY_LENGTH = 20;

/** Konsequenzzeile des Bogens. Der Text dazu gehört zum Zustand (SheetState) und hängt am Schlüssel. */
export interface ConsequenceSlot {
  key: string;
  value: ConsequenceValue;
}

export const isConsequenceValue = (value: unknown): value is ConsequenceValue =>
  CONSEQUENCE_VALUES.includes(value as ConsequenceValue);

/**
 * Zufälliger Schlüssel für eine neue Konsequenzzeile (nie wiederverwendet, damit kein alter Text auftaucht).
 * getRandomValues statt randomUUID: das gibt es auch, wenn die Seite über unverschlüsseltes HTTP läuft.
 */
export const newConsequenceKey = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Der Bogen selbst - wird im Bearbeiten-Modus gepflegt und erst mit "Speichern" übernommen.
 * Was sich im Spiel ändert (Stress, Konsequenzen), steht getrennt in SheetState.
 */
export interface SheetData {
  name: string;
  age: string;
  pronouns: string;
  aspects: Record<AspectKey, string>;
  stunts: string;
  refresh: string;
  /** Anzahl nutzbarer Kästchen je Stressleiste (MIN_STRESS_BOXES bis STRESS_BOXES); die übrigen sind ausgegraut */
  stressBoxes: Record<StressKey, number>;
  /** Konsequenzzeilen in der Reihenfolge auf dem Bogen */
  consequences: ConsequenceSlot[];
  /** Wert je Fertigkeit, Schlüssel ist die ID der Gruppen-Fertigkeit */
  skills: Record<string, number>;
}

/** Zustand im Spiel: wird auch in der Artikelansicht geändert und sofort gespeichert */
export interface SheetState {
  /** angekreuzte Kästchen, immer STRESS_BOXES je Leiste */
  stress: Record<StressKey, boolean[]>;
  /** Text je Konsequenzzeile (Schlüssel aus SheetData.consequences) */
  consequences: Record<string, string>;
}

/**
 * Gespeicherter Bogen. Bogen und Zustand tragen je eine eigene Version: Wer im Spiel Stress ankreuzt,
 * stört niemanden, der gerade den Bogen bearbeitet - und umgekehrt.
 */
export interface Sheet {
  data: SheetData;
  version: number;
  state: SheetState;
  stateVersion: number;
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
    stressBoxes: { physical: DEFAULT_STRESS_BOXES, mental: DEFAULT_STRESS_BOXES },
    consequences: DEFAULT_CONSEQUENCES.map((value) => ({ key: newConsequenceKey(), value })),
    skills: {},
  };
}

export function emptySheetState(): SheetState {
  return { stress: { physical: Array(STRESS_BOXES).fill(false), mental: Array(STRESS_BOXES).fill(false) }, consequences: {} };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const line = (value: unknown, fallback: string) => (typeof value === 'string' ? replaceControlChars(value) : fallback);
const text = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

/**
 * Macht aus beliebigen gespeicherten Daten einen vollständigen Bogen: Fehlendes oder Unpassendes
 * (Eingriff von Hand in die Datenbank, Schutz vor kaputten Clients) wird durch die Vorgabe ersetzt,
 * einzeilige Felder werden von Steuerzeichen befreit. Fertigkeitswerte prüft der Server gegen die Liste der Gruppe.
 */
export function normalizeSheet(raw: unknown): SheetData {
  const sheet = emptySheet();
  // Feste Schlüssel: sonst bekämen kaputte Daten bei jedem Lesen neue und eingetragene Texte gingen verloren
  sheet.consequences = DEFAULT_CONSEQUENCES.map((value, index) => ({ key: `d${index}`, value }));
  if (!isRecord(raw)) return sheet;

  sheet.name = line(raw.name, sheet.name);
  sheet.age = line(raw.age, sheet.age);
  sheet.pronouns = line(raw.pronouns, sheet.pronouns);
  sheet.refresh = line(raw.refresh, sheet.refresh);
  sheet.stunts = text(raw.stunts, sheet.stunts);
  if (isRecord(raw.aspects)) {
    for (const key of Object.keys(sheet.aspects) as AspectKey[]) sheet.aspects[key] = text(raw.aspects[key], sheet.aspects[key]);
  }
  if (isRecord(raw.stressBoxes)) {
    for (const key of Object.keys(sheet.stressBoxes) as StressKey[]) {
      const count = raw.stressBoxes[key];
      if (Number.isInteger(count) && (count as number) >= MIN_STRESS_BOXES && (count as number) <= STRESS_BOXES) {
        sheet.stressBoxes[key] = count as number;
      }
    }
  }
  if (Array.isArray(raw.consequences)) {
    const seen = new Set<string>();
    sheet.consequences = raw.consequences
      .filter((c): c is ConsequenceSlot => {
        if (!isRecord(c) || !isConsequenceValue(c.value) || typeof c.key !== 'string') return false;
        if (c.key === '' || c.key.length > MAX_CONSEQUENCE_KEY_LENGTH || seen.has(c.key)) return false;
        seen.add(c.key);
        return true;
      })
      .slice(0, MAX_CONSEQUENCES)
      .map(({ key, value }) => ({ key, value }));
  }
  if (isRecord(raw.skills)) {
    for (const [id, value] of Object.entries(raw.skills)) {
      if (Number.isInteger(value)) sheet.skills[id] = value as number;
    }
  }
  return sheet;
}

/**
 * Wie normalizeSheet für den Zustand. Mit data werden Texte zu Konsequenzzeilen verworfen,
 * die es auf dem Bogen nicht (mehr) gibt.
 */
export function normalizeSheetState(raw: unknown, data?: SheetData): SheetState {
  const state = emptySheetState();
  if (!isRecord(raw)) return state;
  if (isRecord(raw.stress)) {
    for (const key of Object.keys(state.stress) as StressKey[]) {
      const boxes = raw.stress[key];
      if (Array.isArray(boxes)) state.stress[key] = state.stress[key].map((_, i) => boxes[i] === true);
    }
  }
  if (isRecord(raw.consequences)) {
    const keep = data && new Set(data.consequences.map((c) => c.key));
    for (const [key, value] of Object.entries(raw.consequences)) {
      if (typeof value !== 'string' || value === '' || key.length > MAX_CONSEQUENCE_KEY_LENGTH) continue;
      if (!keep || keep.has(key)) state.consequences[key] = line(value, '');
    }
  }
  return state;
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
