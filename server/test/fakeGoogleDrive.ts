import { createHash } from 'node:crypto';

// Gemockte Google-APIs (OAuth-Token-Endpunkt, Drive v3, Resumable Upload) für die Tests des Drive-Anbieters.
// Bildet nur nach, was googleDrive.ts nutzt, inklusive drive.file: Dateien mit appVisible=false sieht die App nicht.

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  content: Buffer;
  /** mit drive.file nur sichtbar, wenn die App die Datei angelegt hat bzw. sie per Picker freigegeben wurde */
  appVisible: boolean;
}

export interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export const FAKE_CLIENT = {
  clientId: 'test-client.apps.googleusercontent.com',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost:5173/api/storage/google-drive/oauth/callback',
};

const FOLDER = 'application/vnd.google-apps.folder';

export function fakeGoogleDrive() {
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}${(++counter).toString().padStart(6, '0')}`;
  const state = {
    now: Date.parse('2030-01-01T00:00:00Z'),
    codes: new Map<string, { challenge: string; scope: string; refreshToken: boolean }>(),
    refreshTokens: new Set<string>(),
    accessTokens: new Map<string, number>(),
    files: new Map<string, FakeDriveFile>(),
    requests: [] as FakeRequest[],
    /** alle ausgegebenen Tokens, um zu prüfen, dass sie nirgends auftauchen */
    issued: [] as string[],
    /** Antwortet Drive (nicht der Token-Endpunkt) mit diesem Status */
    driveStatus: null as null | { status: number; reason: string },
    tokenEndpointCalls: 0,
  };

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const apiError = (status: number, reason: string) => json(status, { error: { code: status, errors: [{ reason }] } });

  function issueAccess(): { token: string; expires: number } {
    const token = `ya29.ZUGANG-${nextId('')}`;
    state.accessTokens.set(token, state.now + 3600 * 1000);
    state.issued.push(token);
    return { token, expires: 3600 };
  }

  /** Simuliert die Zustimmung bei Google und liefert den Code für den Callback. */
  function authorize(challenge: string, options: { scope?: string; refreshToken?: boolean } = {}): string {
    const code = `4/CODE-${nextId('')}`;
    state.codes.set(code, {
      challenge,
      scope: options.scope ?? 'https://www.googleapis.com/auth/drive.file',
      refreshToken: options.refreshToken ?? true,
    });
    return code;
  }

  function addFile(file: Partial<FakeDriveFile> & { name: string }): FakeDriveFile {
    const full: FakeDriveFile = {
      id: nextId('file'),
      mimeType: 'audio/mpeg',
      parents: ['root'],
      trashed: false,
      content: Buffer.from(`Inhalt von ${file.name}`),
      appVisible: true,
      ...file,
    };
    state.files.set(full.id, full);
    return full;
  }

  const visible = (id: string) => {
    const f = state.files.get(id);
    return f && f.appVisible ? f : undefined;
  };

  /** Mini-Auswertung der q-Ausdrücke, die googleDrive.ts erzeugt */
  function matches(file: FakeDriveFile, q: string): boolean {
    const unq = (s: string) => s.replace(/\\(.)/g, '$1');
    const lit = "'((?:[^'\\\\]|\\\\.)*)'";
    const parent = new RegExp(`${lit} in parents`).exec(q);
    if (parent && !file.parents.includes(unq(parent[1]!))) return false;
    const name = new RegExp(`name = ${lit}`).exec(q);
    if (name && file.name !== unq(name[1]!)) return false;
    if (/trashed = false/.test(q) && file.trashed) return false;
    if (/mimeType contains 'audio\/'/.test(q)) {
      if (!file.mimeType.startsWith('audio/') && file.mimeType !== 'application/ogg') return false;
    } else {
      const mime = new RegExp(`mimeType = ${lit}`).exec(q);
      if (mime && file.mimeType !== unq(mime[1]!)) return false;
    }
    return true;
  }

  function resource(f: FakeDriveFile) {
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: String(f.content.length),
      modifiedTime: '2030-01-01T00:00:00.000Z',
      parents: f.parents,
      trashed: f.trashed,
      capabilities: { canAddChildren: f.mimeType === FOLDER, canListChildren: f.mimeType === FOLDER },
    };
  }

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body === undefined || init.body === null ? '' : String(init.body);
    state.requests.push({ method, url: url.toString(), headers, body });

    if (url.toString() === 'https://oauth2.googleapis.com/token') {
      state.tokenEndpointCalls++;
      const form = new URLSearchParams(body);
      if (form.get('client_id') !== FAKE_CLIENT.clientId || form.get('client_secret') !== FAKE_CLIENT.clientSecret) {
        return json(401, { error: 'invalid_client' });
      }
      if (form.get('grant_type') === 'authorization_code') {
        const entry = state.codes.get(form.get('code') ?? '');
        state.codes.delete(form.get('code') ?? '');
        const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (!entry || entry.challenge !== challenge || form.get('redirect_uri') !== FAKE_CLIENT.redirectUri) {
          return json(400, { error: 'invalid_grant' });
        }
        const access = issueAccess();
        const result: Record<string, unknown> = { access_token: access.token, expires_in: access.expires, scope: entry.scope, token_type: 'Bearer' };
        if (entry.refreshToken) {
          const refresh = `1//REFRESH-${nextId('')}`;
          state.refreshTokens.add(refresh);
          state.issued.push(refresh);
          result.refresh_token = refresh;
        }
        return json(200, result);
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (!state.refreshTokens.has(form.get('refresh_token') ?? '')) return json(400, { error: 'invalid_grant' });
        const access = issueAccess();
        return json(200, { access_token: access.token, expires_in: access.expires, scope: 'https://www.googleapis.com/auth/drive.file' });
      }
      return json(400, { error: 'unsupported_grant_type' });
    }

    // Ab hier Drive: Bearer-Token prüfen
    const token = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1];
    const expires = token ? state.accessTokens.get(token) : undefined;
    if (expires === undefined || expires <= state.now) return apiError(401, 'authError');
    if (state.driveStatus) return apiError(state.driveStatus.status, state.driveStatus.reason);

    if (url.origin === 'https://www.googleapis.com' && url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      if (url.searchParams.get('uploadType') !== 'resumable') return apiError(400, 'badRequest');
      const meta = JSON.parse(body) as { parents?: string[] };
      if (!meta.parents?.every((p) => visible(p)?.mimeType === FOLDER)) return apiError(404, 'notFound');
      return new Response(null, { status: 200, headers: { location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=SESSION-${nextId('')}` } });
    }
    if (url.pathname === '/drive/v3/about') return json(200, { user: { emailAddress: 'alice@gmail.com' } });
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const all = [...state.files.values()].filter((f) => f.appVisible && matches(f, q)).sort((a, b) => a.name.localeCompare(b.name));
      const offset = Number(url.searchParams.get('pageToken') ?? 0);
      const size = Number(url.searchParams.get('pageSize') ?? 100);
      const page = all.slice(offset, offset + size);
      return json(200, { files: page.map(resource), ...(offset + size < all.length ? { nextPageToken: String(offset + size) } : {}) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const meta = JSON.parse(body) as { name: string; mimeType: string; parents?: string[] };
      const f = addFile({ name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? ['root'], content: Buffer.alloc(0) });
      return json(200, { id: f.id, name: f.name });
    }
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (fileMatch) {
      const file = visible(decodeURIComponent(fileMatch[1]!));
      if (!file) return apiError(404, 'notFound');
      if (method === 'PATCH') {
        Object.assign(file, JSON.parse(body));
        return json(200, { id: file.id });
      }
      if (url.searchParams.get('alt') === 'media') {
        const range = /^bytes=(\d+)-(\d*)$/.exec(headers.range ?? '');
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Number(range[2]) : file.content.length - 1;
          if (start >= file.content.length) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.content.length}` } });
          const part = file.content.subarray(start, end + 1);
          return new Response(new Uint8Array(part), {
            status: 206,
            headers: { 'content-type': file.mimeType, 'content-length': String(part.length), 'content-range': `bytes ${start}-${end}/${file.content.length}`, 'accept-ranges': 'bytes' },
          });
        }
        return new Response(new Uint8Array(file.content), { status: 200, headers: { 'content-type': file.mimeType, 'content-length': String(file.content.length) } });
      }
      return json(200, resource(file));
    }
    return apiError(404, 'notFound');
  };

  return { state, authorize, addFile, fetch: fetchImpl as typeof fetch };
}
