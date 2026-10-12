// VORÜBERGEHEND: Auswahl der Rahmengröße zum Ausprobieren. Sobald eine Größe feststeht, --vine-width in app.css
// setzen und diese Datei, FrameSizePicker.svelte samt Einbindung in App.svelte und den Test wieder entfernen.

/** Prozent der bisherigen Breite (44px) */
export const FRAME_SIZES = [70, 75, 80, 85, 90, 95, 100] as const;
export type FrameSize = (typeof FRAME_SIZES)[number];

const BASE_WIDTH_PX = 44;
const STORAGE_KEY = 'pnp-frame-size';

export function storedFrameSize(): FrameSize {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return FRAME_SIZES.includes(stored as FrameSize) ? (stored as FrameSize) : 100;
}

/** Überschreibt --vine-width an <html>; --vine-gap und alle Abstände leiten sich davon ab. Bleibt im Browser gespeichert. */
export function applyFrameSize(size: FrameSize): void {
  document.documentElement.style.setProperty('--vine-width', `${(BASE_WIDTH_PX * size) / 100}px`);
  localStorage.setItem(STORAGE_KEY, String(size));
}
