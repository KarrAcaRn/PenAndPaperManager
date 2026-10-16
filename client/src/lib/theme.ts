/**
 * Theme-API des Clients. Das aktive Theme ist ein <link id="theme-stylesheet"> auf das vom Server erzeugte
 * Stylesheet (/themes/<id>/theme.css) plus das Attribut data-theme am <html>-Element. applyTheme() tauscht das
 * Stylesheet ohne Neuladen aus; das alte bleibt aktiv, bis das neue geladen ist (kein Aufblitzen ohne Farben).
 */
import { BASE_THEME_ID, themeStylesheetUrl, type ThemeInfo } from '@pnp/shared';
import { api } from './api.ts';

export const THEME_LINK_ID = 'theme-stylesheet';
/** immer geladenes Basis-Theme aus index.html; hält die Seite gestaltet, falls ein gewähltes Theme fehlt */
export const THEME_BASE_LINK_ID = 'theme-base';

/** alle verfügbaren Themes (eingebaute und die des Seitenbetreibers) */
export async function listThemes(): Promise<ThemeInfo[]> {
  return (await api.themes()).themes;
}

/** alle Themes und das Vorgabe-Theme der Seite (für alle ohne eigene Wahl) */
export function themeCatalog(): Promise<{ themes: ThemeInfo[]; defaultTheme: string }> {
  return api.themes();
}

/** ein Theme mit allen Token-Werten; wirft ApiFailure 404, wenn es nicht (mehr) existiert */
export async function getTheme(id: string): Promise<ThemeInfo> {
  return (await api.theme(id)).theme;
}

/** ID des angewendeten Themes; leer, solange index.html das Vorgabe-Theme der Seite per Weiterleitung geladen hat */
export function currentTheme(): string {
  return document.documentElement.dataset.theme ?? BASE_THEME_ID;
}

let pending = 0;
/** Abbruch der noch ladenden Stylesheets (siehe cancelPendingThemes) */
const cancels = new Set<() => void>();

/**
 * Verwirft alle noch ladenden Theme-Wechsel, z.B. wenn das gewünschte Theme schon aktiv ist und nichts geladen
 * werden muss – sonst würde ein später fertiges, älteres Stylesheet es noch überschreiben.
 */
export function cancelPendingThemes(): void {
  pending++;
  for (const cancel of [...cancels]) cancel();
}

/**
 * Wendet ein Theme zur Laufzeit an. Liefert true, sobald das Stylesheet geladen und aktiv ist, und false, wenn
 * inzwischen ein neuerer Aufruf kam (dann gewinnt dieser, auch wenn er früher fertig ist). Kann das Stylesheet
 * nicht geladen werden, schlägt der Aufruf fehl und das bisherige Theme bleibt aktiv.
 */
export function applyTheme(id: string): Promise<boolean> {
  const request = ++pending;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeStylesheetUrl(id);
  link.dataset.themePending = id;
  return new Promise<boolean>((resolve, reject) => {
    const cancel = () => {
      cancels.delete(cancel);
      link.remove();
      resolve(false);
    };
    cancels.add(cancel);
    link.addEventListener('load', () => {
      cancels.delete(cancel);
      if (request !== pending) {
        link.remove();
        return resolve(false);
      }
      for (const old of document.querySelectorAll(`link#${THEME_LINK_ID}`)) old.remove();
      delete link.dataset.themePending;
      link.id = THEME_LINK_ID;
      document.documentElement.dataset.theme = id;
      resolve(true);
    });
    link.addEventListener('error', () => {
      cancels.delete(cancel);
      link.remove();
      // Fehler eines überholten Aufrufs interessieren niemanden mehr
      if (request !== pending) resolve(false);
      else reject(new Error(`Das Theme „${id}“ konnte nicht geladen werden.`));
    });
    // nach dem aktiven Stylesheet (bzw. dem Basis-Theme) einfügen, damit das neue in der Kaskade gewinnt
    const active = document.getElementById(THEME_LINK_ID) ?? document.getElementById(THEME_BASE_LINK_ID);
    if (active) active.after(link);
    else document.head.append(link);
  });
}
