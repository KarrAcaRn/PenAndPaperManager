// Kleine Übersetzungshilfe: Texte liegen je Bereich als Katalog vor (Deutsch ist Pflicht und Vorgabe, weitere
// Sprachen dürfen einzelne Texte auslassen). Platzhalter im Text: {name}.

export const DEFAULT_LOCALE = 'de';

/** Sprache der Seite (<html lang>), z.B. "en" aus "en-US"; ohne Angabe Deutsch */
export function currentLocale(): string {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return lang.split('-')[0]?.toLowerCase() || DEFAULT_LOCALE;
}

export type Translator<K extends string> = (key: K, params?: Record<string, string | number>) => string;

/**
 * Übersetzer für einen Katalog. Fehlt ein Text in der aktuellen Sprache, gilt der deutsche.
 * `locale` ist nur für Tests gedacht, sonst entscheidet <html lang> bei jedem Aufruf.
 */
export function createTranslator<M extends Record<string, string>>(
  catalogs: { de: M } & Record<string, Partial<M>>,
  locale?: () => string,
): Translator<Extract<keyof M, string>> {
  return (key, params) => {
    const text = catalogs[(locale ?? currentLocale)()]?.[key] ?? catalogs.de[key];
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
  };
}
