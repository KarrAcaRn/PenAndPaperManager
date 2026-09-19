import {
  CONTROL_CHARS_SOURCE,
  INVISIBLE_CHARS_SOURCE,
  MAX_EMAIL_LENGTH,
  MAX_SKILLS,
  MAX_SKILL_NAME_LENGTH,
  SECTIONS,
} from '@pnp/shared';

/** Ganzzahlige URL-Parameter */
export const intParams = (...names: string[]) => ({
  type: 'object',
  properties: Object.fromEntries(names.map((name) => [name, { type: 'integer' }])),
});

/** URL-Parameter von Gruppen-Routen: immer :gid, dazu die genannten weiteren IDs */
export const idParams = (...names: string[]) => intParams('gid', ...names);

export const gidParams = idParams();

const NO_CONTROL = CONTROL_CHARS_SOURCE.replace('[', '[^');
const VISIBLE = INVISIBLE_CHARS_SOURCE.replace('[', '[^');

/** Einzeiliger String ohne Steuerzeichen mit mindestens einem sichtbaren Zeichen (Ajv nutzt das u-Flag) */
export const nonBlank = (maxLength: number) => ({
  type: 'string',
  maxLength,
  pattern: `^(?=.*${VISIBLE})${NO_CONTROL}*$`,
});

export const sectionProp = { enum: SECTIONS };

// Nur grobe Grenzen (doppelte Länge lässt Platz für Leerraum, der noch weggetrimmt wird);
// die genaue Prüfung samt Duplikaten macht normalizeSkillNames.
export const skillName = { type: 'string', maxLength: MAX_SKILL_NAME_LENGTH * 2 };
export const skillList = (items: object) => ({ type: 'array', maxItems: MAX_SKILLS, items });
export const skillNames = skillList(skillName);

/** Objekt mit genau diesen Feldern; unbekannte Felder entfernt Fastify stillschweigend (removeAdditional). */
export const objectOf = (properties: Record<string, object>, required: string[] = Object.keys(properties)) => ({
  type: 'object',
  required,
  properties,
  additionalProperties: false,
});

export const emailBody = objectOf({
  email: { type: 'string', maxLength: MAX_EMAIL_LENGTH, pattern: '^\\s*[^@\\s]+@[^@\\s]+\\.[^@\\s]+\\s*$' },
});
