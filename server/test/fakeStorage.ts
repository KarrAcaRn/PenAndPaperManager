import type { StorageFile } from '@pnp/shared';
import { StorageProviderError, type StorageProviderDefinition } from '../src/storage/provider.ts';
import { StorageProviderRegistry } from '../src/storage/registry.ts';

// Fake-Anbieter für Tests: Dateien liegen im Speicher, das Verhalten lässt sich über `fake` steuern.
// Er tritt unter dem Typ 's3' auf, weil providerType nur bekannte Typen zulässt.

export interface FakeConfig {
  [key: string]: unknown;
  bucket: string;
}

export interface FakeCredentials {
  token: string;
  /** Zähler für erneuerte Tokens (simuliert OAuth-Refresh) */
  refreshed?: number;
}

export interface FakeState {
  files: StorageFile[];
  /** Token, die der "Anbieter" nicht (mehr) akzeptiert */
  revoked: Set<string>;
  /** nächste Aktion schlägt mit diesem Fehler fehl */
  failNext: StorageProviderError | null;
  /** bei jeder Aktion das Token erneuern und speichern */
  refreshTokens: boolean;
  /** zuletzt gesehene Aufrufe, z.B. ['listFiles', {...}] */
  calls: [string, unknown][];
  /** Zugangsdaten, mit denen der Anbieter zuletzt erzeugt wurde */
  lastCredentials: FakeCredentials | null;
}

export function fakeStorage() {
  const state: FakeState = { files: [], revoked: new Set(), failNext: null, refreshTokens: false, calls: [], lastCredentials: null };

  const definition: StorageProviderDefinition<FakeConfig, FakeCredentials> = {
    type: 's3',
    parseInput(config, credentials) {
      if (typeof config.bucket !== 'string' || config.bucket === '') throw new StorageProviderError('invalid', 'Bucket fehlt');
      if (typeof credentials.token !== 'string') throw new StorageProviderError('invalid', 'Token fehlt');
      return { config: { bucket: config.bucket }, credentials: { token: credentials.token } };
    },
    create(conn) {
      state.lastCredentials = conn.credentials;
      const step = (name: string, arg?: unknown) => {
        state.calls.push([name, arg]);
        if (state.failNext) {
          const err = state.failNext;
          state.failNext = null;
          throw err;
        }
        if (state.revoked.has(conn.credentials.token)) throw new StorageProviderError('auth', 'Zugriff wurde widerrufen');
        if (state.refreshTokens) {
          const refreshed = (conn.credentials.refreshed ?? 0) + 1;
          conn.saveCredentials({ token: conn.credentials.token, refreshed });
        }
      };
      const find = (fileId: string) => {
        const file = state.files.find((f) => f.id === fileId);
        if (!file) throw new StorageProviderError('not_found', 'Datei nicht gefunden');
        return file;
      };
      return {
        async validate() {
          step('validate');
        },
        async listFiles(options) {
          step('listFiles', options);
          return { files: state.files, nextCursor: options.cursor ? null : 'seite2' };
        },
        async getPlaybackUrl(fileId) {
          step('getPlaybackUrl', fileId);
          find(fileId);
          return { url: `https://fake.example/${conn.config.bucket}/${encodeURIComponent(fileId)}?sig=x`, expiresAt: '2030-01-01T00:00:00.000Z' };
        },
        async upload(request) {
          step('upload', request);
          return {
            method: 'PUT',
            url: `https://fake.example/${conn.config.bucket}/${encodeURIComponent(request.fileName)}?sig=up`,
            headers: { 'Content-Type': request.contentType },
            fields: {},
            fileId: request.fileName,
            expiresAt: '2030-01-01T00:00:00.000Z',
          };
        },
        async delete(fileId) {
          step('delete', fileId);
          find(fileId);
          state.files = state.files.filter((f) => f.id !== fileId);
        },
      };
    },
  };

  return { state, registry: new StorageProviderRegistry().register(definition) };
}
