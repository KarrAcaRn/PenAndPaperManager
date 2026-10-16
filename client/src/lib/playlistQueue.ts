// Warteschlange einer Musik-Playlist ohne Oberfläche und ohne Wiedergabe: welcher Eintrag kommt als Nächstes,
// welcher davor, was passiert beim Entfernen. Gearbeitet wird mit den IDs der Einträge (nicht mit Positionen),
// damit Umsortieren den laufenden Titel nicht verschiebt (wie `reorderBackgroundPlaylist` in der Referenz).
//
// Referenz (board.js `onBackgroundTrackEnded`, `skipBackgroundTrack`): nach dem letzten Titel folgt wieder der
// erste. Das ist bei uns „Wiederholen: alle“ (Vorgabe); dazu kommen „aus“ (nach dem letzten ist Schluss),
// „einer“ (der Titel wiederholt sich, bis man weiterschaltet) und Zufall.

export type RepeatMode = 'off' | 'all' | 'one';
export const REPEAT_MODES: readonly RepeatMode[] = ['off', 'all', 'one'];

export interface Queue {
  /** ID des aktuellen Eintrags */
  current: string;
  /** in diesem Durchgang schon gespielte Einträge, der aktuelle zuletzt (für Zufall und „Zurück“) */
  played: string[];
}

export interface QueueMode {
  shuffle: boolean;
  repeat: RepeatMode;
  /** für Tests austauschbar, liefert 0 ≤ x < 1 */
  random?: () => number;
}

const pick = (ids: readonly string[], random: () => number): string =>
  ids[Math.min(ids.length - 1, Math.floor(random() * ids.length))];

/** Erster Eintrag beim Start: der erste oder bei Zufall ein zufälliger */
export function firstTrack(ids: readonly string[], mode: QueueMode): Queue | null {
  if (ids.length === 0) return null;
  const current = mode.shuffle ? pick(ids, mode.random ?? Math.random) : ids[0];
  return { current, played: [current] };
}

/** Start bei einem bestimmten Eintrag (Doppelklick in der Liste) */
export const startAt = (id: string): Queue => ({ current: id, played: [id] });

/**
 * Nächster Eintrag oder null, wenn die Playlist zu Ende ist. `auto`: der Titel ist von selbst zu Ende gelaufen –
 * nur dann bleibt „Wiederholen: einer“ beim Titel; wer weiterschaltet, kommt auch dann zum nächsten.
 */
export function nextTrack(queue: Queue | null, ids: readonly string[], mode: QueueMode, auto = false): Queue | null {
  if (ids.length === 0) return null;
  if (!queue) return firstTrack(ids, mode);
  if (auto && mode.repeat === 'one' && ids.includes(queue.current)) return { ...queue, played: [...queue.played] };
  const wrap = mode.repeat !== 'off';
  const played = queue.played.filter((id) => ids.includes(id));
  if (mode.shuffle) {
    const random = mode.random ?? Math.random;
    const remaining = ids.filter((id) => !played.includes(id));
    if (remaining.length > 0) {
      const id = pick(remaining, random);
      return { current: id, played: [...played, id] };
    }
    if (!wrap) return null;
    // neuer Durchgang; nicht gleich wieder mit dem Titel beginnen, der gerade lief
    const id = pick(ids.length > 1 ? ids.filter((i) => i !== queue.current) : ids, random);
    return { current: id, played: [id] };
  }
  const index = ids.indexOf(queue.current) + 1;
  if (index < ids.length) return { current: ids[index], played: [...played.filter((id) => id !== ids[index]), ids[index]] };
  if (!wrap) return null;
  return { current: ids[0], played: [ids[0]] };
}

/**
 * Vorheriger Eintrag: bei Zufall der zuvor gespielte (sonst bleibt es beim aktuellen, er beginnt von vorn),
 * sonst der davor in der Liste; vor dem ersten der letzte, wenn wiederholt wird.
 */
export function previousTrack(queue: Queue | null, ids: readonly string[], mode: QueueMode): Queue | null {
  if (ids.length === 0) return null;
  if (!queue || !ids.includes(queue.current)) return firstTrack(ids, mode);
  const played = queue.played.filter((id) => ids.includes(id) && id !== queue.current);
  if (mode.shuffle) {
    if (played.length === 0) return { current: queue.current, played: [queue.current] };
    return { current: played[played.length - 1], played };
  }
  let index = ids.indexOf(queue.current) - 1;
  if (index < 0) index = mode.repeat === 'off' ? 0 : ids.length - 1;
  const id = ids[index];
  return { current: id, played: [...played.filter((p) => p !== id), id] };
}

/**
 * Ein Eintrag wurde entfernt (`idsBefore` = Reihenfolge davor). War es der aktuelle, geht es wie in der Referenz
 * (`removeBackgroundItem`) mit dem nächsten weiter (`changed`); ist keiner mehr übrig, ist `queue` null.
 */
export function afterRemove(
  queue: Queue | null,
  removed: string,
  idsBefore: readonly string[],
  mode: QueueMode,
): { queue: Queue | null; changed: boolean } {
  if (!queue) return { queue: null, changed: false };
  const ids = idsBefore.filter((id) => id !== removed);
  const played = queue.played.filter((id) => id !== removed);
  if (queue.current !== removed) return { queue: { current: queue.current, played }, changed: false };
  // „einer“ wirkt hier wie „alle“: der Titel ist ja weg
  const skip: QueueMode = { ...mode, repeat: mode.repeat === 'one' ? 'all' : mode.repeat };
  if (mode.shuffle) return { queue: nextTrack({ current: '', played }, ids, skip), changed: true };
  const position = idsBefore.indexOf(removed);
  const before = position > 0 ? { current: ids[position - 1], played } : null;
  return { queue: before ? nextTrack(before, ids, skip) : firstTrack(ids, skip), changed: true };
}

/** Verschiebt einen Eintrag von `from` nach `to` (Positionen); liefert eine neue Liste */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return result;
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}
