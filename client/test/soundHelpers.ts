import type { BuiltinSound, StorageConnection } from '@pnp/shared';

// Testdaten und Nachbauten fürs Soundboard

export const builtinSound = (id: string, title: string, category: string): BuiltinSound => ({
  source: 'builtin',
  id,
  title,
  url: `/sounds/default/${id}.wav`,
  category,
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

