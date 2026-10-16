// Tastatur im Soundboard wie in der Referenz (pnp-soundboard, board.js `keyBindings`/`hotButton`):
// Die sichtbaren Kacheln bekommen der Reihe nach 0–9, a–z, A–Z; Pfeil links/rechts wechselt die Kategorie,
// Pfeil hoch/runter ändert die Lautstärke, Alt springt ins Suchfeld. Beim Tippen und bei offenem Dialog ist alles aus.

/** 62 Plätze: 0–9, a–z, A–Z */
export const HOTKEYS: readonly string[] = [
  ...'0123456789',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
];

/** Lautstärke-Schritt je Pfeiltaste (Referenz: 1 von 100) */
export const VOLUME_STEP = 0.01;

/** Ordnet den Kacheln in Anzeigereihenfolge ihre Taste zu (Sound-key → Taste); mehr als 62 Kacheln bleiben ohne */
export function assignHotkeys(soundKeys: readonly string[]): Map<string, string> {
  return new Map(soundKeys.slice(0, HOTKEYS.length).map((key, i) => [key, HOTKEYS[i]]));
}

/** Kategorie davor/danach, ringsum; '' (= alle) gehört mit zur Reihe und steht vorn */
export function stepCategory(categories: readonly string[], current: string, step: 1 | -1): string {
  const all = ['', ...categories];
  const index = Math.max(0, all.indexOf(current));
  return all[(index + step + all.length) % all.length];
}

/** Eingabefelder, in denen Tasten Text sind und keine Kürzel */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Ein offener modaler Dialog (z.B. „Hinzufügen“) schaltet die Kürzel ab; Esc gehört dann dem Dialog */
export function modalOpen(doc: Document = document): boolean {
  return doc.querySelector('dialog[open], [aria-modal="true"]') !== null;
}

export type HotkeyAction =
  | { kind: 'sound'; soundKey: string }
  | { kind: 'category'; step: 1 | -1 }
  | { kind: 'volume'; step: number }
  | { kind: 'search' };

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'target'>;

/**
 * Was eine Taste auslöst (oder null). `bySoundKey` ist die Zuordnung aus `assignHotkeys`.
 * Kombinationen mit Strg/Cmd bleiben dem Browser.
 */
export function hotkeyAction(event: KeyEventLike, bySoundKey: ReadonlyMap<string, string>, doc: Document = document): HotkeyAction | null {
  if (event.ctrlKey || event.metaKey || modalOpen(doc) || isTypingTarget(event.target)) return null;
  switch (event.key) {
    case 'Alt':
      return { kind: 'search' };
    case 'ArrowLeft':
      return { kind: 'category', step: -1 };
    case 'ArrowRight':
      return { kind: 'category', step: 1 };
    case 'ArrowUp':
      return { kind: 'volume', step: VOLUME_STEP };
    case 'ArrowDown':
      return { kind: 'volume', step: -VOLUME_STEP };
  }
  if (event.altKey || event.key.length !== 1) return null;
  for (const [soundKey, hotkey] of bySoundKey) if (hotkey === event.key) return { kind: 'sound', soundKey };
  return null;
}
