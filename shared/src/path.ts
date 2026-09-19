export const MAX_PATH_LENGTH = 200;
export const MAX_SEGMENT_LENGTH = 60;

export class PathError extends Error {}

// Als Regex-Quelltext, damit die JSON-Schemas des Servers dieselben Zeichenklassen nutzen können.
/** Steuerzeichen und Zeilentrenner */
export const CONTROL_CHARS_SOURCE = '[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]';
/** Zeichen, die man nicht sieht: Leerraum und Formatzeichen wie Zero-Width-Space */
export const INVISIBLE_CHARS_SOURCE = '[\\p{Cf}\\p{Z}\\s]';
const CONTROL_CHARS = new RegExp(CONTROL_CHARS_SOURCE, 'u');
const INVISIBLE_CHARS = new RegExp(INVISIBLE_CHARS_SOURCE, 'gu');

/**
 * Bringt einen Ordnerpfad in kanonische Form: "bar/foo", '' = Wurzel des Bereichs.
 * Wirft PathError bei ungültigen Pfaden.
 */
export function normalizePath(input: string): string {
  // NFC, damit optisch gleiche Namen (z.B. "ä" von macOS und Windows) denselben Ordner meinen
  const segments = input
    .normalize('NFC')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  for (const s of segments) {
    if (s === '.' || s === '..') throw new PathError('"." und ".." sind als Ordnernamen nicht erlaubt');
    if (s.length > MAX_SEGMENT_LENGTH) throw new PathError(`Ordnername zu lang (max. ${MAX_SEGMENT_LENGTH} Zeichen)`);
    if (CONTROL_CHARS.test(s) || s.includes('\\')) throw new PathError('Ordnername enthält ungültige Zeichen');
    if (s.replace(INVISIBLE_CHARS, '') === '') throw new PathError('Ordnername besteht nur aus unsichtbaren Zeichen');
  }
  const path = segments.join('/');
  if (path.length > MAX_PATH_LENGTH) throw new PathError(`Pfad zu lang (max. ${MAX_PATH_LENGTH} Zeichen)`);
  return path;
}

/** "a/b/c" -> ["a", "a/b", "a/b/c"] */
export function pathPrefixes(path: string): string[] {
  if (path === '') return [];
  const segments = path.split('/');
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function joinPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`;
}

/** true, wenn path gleich ancestor ist oder darunter liegt */
export function isWithin(path: string, ancestor: string): boolean {
  return ancestor === '' || path === ancestor || path.startsWith(ancestor + '/');
}
