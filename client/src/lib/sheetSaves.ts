/**
 * Laufende Speichervorgänge je FATE-Bogen (Artikel-ID), über Komponenten hinweg: Beim Wechsel vom
 * Bearbeiten in die Ansicht speichert die alte Seite beim Abbau nach, während die neue schon lädt.
 * Die neue wartet darauf, sonst sähe sie den alten Stand samt alter Version (und liefe in einen Konflikt).
 */
const pending = new Map<number, Set<Promise<unknown>>>();

export function trackSheetSave<T>(articleId: number, promise: Promise<T>): Promise<T> {
  const set = pending.get(articleId) ?? new Set();
  pending.set(articleId, set);
  set.add(promise);
  const done = () => {
    set.delete(promise);
    if (set.size === 0 && pending.get(articleId) === set) pending.delete(articleId);
  };
  promise.then(done, done);
  return promise;
}

/** Erfüllt sich, sobald alle bis jetzt begonnenen Speichervorgänge des Bogens beendet sind (auch mit Fehler). */
export async function sheetSavesSettled(articleId: number): Promise<void> {
  await Promise.allSettled([...(pending.get(articleId) ?? [])]);
}
