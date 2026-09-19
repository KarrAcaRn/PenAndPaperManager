import { CONTROL_CHARS_SOURCE, MAX_EMAIL_LENGTH, SECTIONS } from '@pnp/shared';

/** URL-Parameter: immer :gid, dazu die genannten weiteren IDs */
export const idParams = (...names: string[]) => ({
  type: 'object',
  properties: Object.fromEntries(['gid', ...names].map((name) => [name, { type: 'integer' }])),
});

export const gidParams = idParams();

const NO_CONTROL = CONTROL_CHARS_SOURCE.replace('[', '[^');

/** Einzeiliger String ohne Steuerzeichen, der nicht nur aus Leerzeichen besteht */
export const nonBlank = (maxLength: number) => ({
  type: 'string',
  maxLength,
  pattern: `^(?=.*\\S)${NO_CONTROL}*$`,
});

export const sectionProp = { enum: SECTIONS };

export const objectOf = (properties: Record<string, object>, required: string[] = Object.keys(properties)) => ({
  type: 'object',
  required,
  properties,
});

export const emailBody = objectOf({
  email: { type: 'string', maxLength: MAX_EMAIL_LENGTH, pattern: '^\\s*[^@\\s]+@[^@\\s]+\\.[^@\\s]+\\s*$' },
});
