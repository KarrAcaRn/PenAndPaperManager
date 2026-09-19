// Als Regex-Quelltext, damit die JSON-Schemas des Servers dieselben Zeichenklassen nutzen können.
/** Steuerzeichen und Zeilentrenner */
export const CONTROL_CHARS_SOURCE = '[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]';
/** Zeichen, die man nicht sieht: Leerraum und Formatzeichen wie Zero-Width-Space */
export const INVISIBLE_CHARS_SOURCE = '[\\p{Cf}\\p{Z}\\s]';

const CONTROL_CHARS = new RegExp(CONTROL_CHARS_SOURCE, 'u');
const INVISIBLE_CHARS = new RegExp(INVISIBLE_CHARS_SOURCE, 'gu');
const ALL_CONTROL_CHARS = new RegExp(CONTROL_CHARS_SOURCE, 'gu');

export function hasControlChars(text: string): boolean {
  return CONTROL_CHARS.test(text);
}

/** Für einzeilige Felder: Steuerzeichen (z.B. ein mitkopierter Tab) werden zu Leerzeichen */
export function replaceControlChars(text: string): string {
  return text.replace(ALL_CONTROL_CHARS, ' ');
}

/** false für leere Strings und solche, die nur aus Leerraum/Formatzeichen bestehen */
export function hasVisibleText(text: string): boolean {
  return text.replace(INVISIBLE_CHARS, '') !== '';
}
