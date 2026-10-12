// VORÜBERGEHEND: Auswahl der Rahmen-Variante zum Ausprobieren. Sobald eine Variante feststeht, diese Datei,
// FrameVariantPicker.svelte, die Regeln html[data-frame=…] in app.css und die übrigen frame-*.svg entfernen.

export const FRAME_VARIANTS = [
  { id: 'zweige', label: 'Zweige (aktuell)' },
  { id: 'kraeftig', label: 'Kräftige Zweige, große Blätter' },
  { id: 'dicht', label: 'Zweige, dicht belaubt' },
  { id: 'knorrig', label: 'Knorrige Zweige, wenig Laub' },
  { id: 'ranken', label: 'Grüne Ranken (vorher)' },
] as const;

export type FrameVariant = (typeof FRAME_VARIANTS)[number]['id'];

const STORAGE_KEY = 'pnp-frame-variant';
const isVariant = (value: unknown): value is FrameVariant => FRAME_VARIANTS.some((v) => v.id === value);

export function storedFrameVariant(): FrameVariant {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isVariant(stored) ? stored : 'zweige';
}

/** Setzt die Variante an <html data-frame>, app.css tauscht damit die Rahmengrafik; bleibt im Browser gespeichert */
export function applyFrameVariant(variant: FrameVariant): void {
  document.documentElement.dataset.frame = variant;
  localStorage.setItem(STORAGE_KEY, variant);
}
