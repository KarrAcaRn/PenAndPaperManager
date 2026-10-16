import type { BuiltinSound, SoundType, StorageConnection } from '@pnp/shared';

// Testdaten und Nachbauten fürs Soundboard

/** Typ wie im mitgelieferten Manifest: Kategorie „Musik“ ist Musik, sonst Effekt */
export const builtinSound = (id: string, title: string, category: string, type: SoundType = category === 'Musik' ? 'music' : 'sfx'): BuiltinSound => ({
  source: 'builtin',
  id,
  title,
  url: `/sounds/default/${id}.wav`,
  category,
  type,
  durationSec: 1,
  tags: [],
  license: 'CC0',
  mimeType: 'audio/wav',
});

export const connection = (over: Partial<StorageConnection> = {}): StorageConnection => ({
  id: 3,
  providerType: 's3',
  displayName: 'Mein Bucket',
  config: {},
  status: 'connected',
  statusMessage: '',
  createdAt: '2026-10-01 10:00:00',
  updatedAt: '2026-10-01 10:00:00',
  ...over,
});

/** Audio-Element ohne Wiedergabe für den Player; `end()`/`failLoading()` spielen Ende bzw. Ladefehler nach */
export class FakeAudio {
  static all: FakeAudio[] = [];
  src = '';
  volume = 1;
  loop = false;
  /** src vor dem Stoppen, damit Tests gestoppte Elemente wiederfinden */
  removedSrc = '';
  preload = '';
  paused = true;
  currentTime = 0;
  duration = NaN;
  error: { code: number } | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playResult: Promise<void> = Promise.resolve();
  constructor() {
    FakeAudio.all.push(this);
  }
  play() {
    this.paused = false;
    return this.playResult;
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === 'src') [this.removedSrc, this.src] = [this.src, ''];
  }
  failLoading() {
    this.error = { code: 4 };
    this.onerror?.();
  }
  end() {
    this.paused = true;
    this.onended?.();
  }
}

/** Nachbau von XMLHttpRequest, der nichts verschickt; `last` ist die zuletzt erzeugte Anfrage */
export class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

