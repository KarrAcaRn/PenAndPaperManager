/**
 * Theme-API des Clients. Das aktive Theme ist ein <link id="theme-stylesheet"> auf das vom Server erzeugte
 * Stylesheet (/themes/<id>/theme.css) plus das Attribut data-theme am <html>-Element. applyTheme() tauscht das
 * Stylesheet ohne Neuladen aus; das alte bleibt aktiv, bis das neue geladen ist (kein Aufblitzen ohne Farben).
 */
import { BASE_THEME_ID, themeStylesheetUrl, type ThemeInfo } from '@pnp/shared';
import { api } from './api.ts';

export const THEME_LINK_ID = 'theme-stylesheet';

/** alle verfügbaren Themes (eingebaute und die des Seitenbetreibers) */
export async function listThemes(): Promise<ThemeInfo[]> {
  return (await api.themes()).themes;
}

/** ein Theme mit allen Token-Werten; wirft ApiFailure 404, wenn es nicht (mehr) existiert */
export async function getTheme(id: string): Promise<ThemeInfo> {
  return (await api.theme(id)).theme;
}

/** ID des angewendeten Themes */
export function currentTheme(): string {
  return document.documentElement.dataset.theme ?? BASE_THEME_ID;
}

let pending = 0;

/**
 * Wendet ein Theme zur Laufzeit an. Erfüllt sich, sobald das Stylesheet geladen ist; schlägt fehl (und lässt das
 * bisherige Theme aktiv), wenn es nicht geladen werden kann. Bei schnell aufeinanderfolgenden Aufrufen gewinnt der
 * letzte; ältere, noch ladende werden verworfen.
 */
export function applyTheme(id: string): Promise<void> {
  const request = ++pending;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = themeStylesheetUrl(id);
  link.dataset.themePending = id;
  return new Promise<void>((resolve, reject) => {
    link.addEventListener('load', () => {
      if (request !== pending) {
        link.remove();
        return resolve();
      }
      for (const old of document.querySelectorAll(`link#${THEME_LINK_ID}`)) old.remove();
      delete link.dataset.themePending;
      link.id = THEME_LINK_ID;
      document.documentElement.dataset.theme = id;
      resolve();
    });
    link.addEventListener('error', () => {
      link.remove();
      reject(new Error(`Das Theme „${id}“ konnte nicht geladen werden.`));
    });
    // nach dem aktiven Stylesheet einfügen, damit das neue in der Kaskade gewinnt
    const active = document.getElementById(THEME_LINK_ID);
    if (active) active.after(link);
    else document.head.append(link);
  });
}
