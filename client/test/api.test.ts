import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, api, onAuthError } from '../src/lib/api.ts';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body === undefined ? '' : JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('sendet JSON und liefert die Antwort', async () => {
    const fetch = mockFetch(200, { id: 1, email: 'a@test.de' });
    expect(await api.login('a@test.de')).toEqual({ id: 1, email: 'a@test.de' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/auth/login');
    expect(init).toMatchObject({ method: 'POST', body: '{"email":"a@test.de"}' });
  });

  it('sendet bei GET keinen Body', async () => {
    const fetch = mockFetch(200, []);
    await api.groups();
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', body: undefined, headers: undefined });
  });

  it('kodiert Query-Parameter und lässt fehlende weg', async () => {
    const fetch = mockFetch(200, []);
    await api.articles(1, 'notes');
    await api.articles(1, 'notes', '');
    await api.articles(1, 'notes', 'a b/ö&x');
    await api.deleteFolder(1, 'notes', 'a/b');
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/groups/1/articles?section=notes',
      '/api/groups/1/articles?section=notes&path=',
      '/api/groups/1/articles?section=notes&path=a+b%2F%C3%B6%26x',
      '/api/groups/1/folders?section=notes&path=a%2Fb',
    ]);
  });

  it('wirft ApiFailure mit der Server-Meldung', async () => {
    mockFetch(409, { error: 'Ordner ist nicht leer' });
    const err = await api.deleteFolder(1, 'notes', 'a').catch((e) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err).toMatchObject({ status: 409, message: 'Ordner ist nicht leer' });
  });

  it('meldet 401 und 403 an den Auth-Handler, andere Fehler nicht', async () => {
    const handler = vi.fn();
    onAuthError(handler);
    for (const status of [401, 403, 404, 500]) {
      mockFetch(status, { error: 'x' });
      await api.groups().catch(() => {});
    }
    expect(handler.mock.calls).toEqual([[401], [403]]);
    onAuthError(() => {});
  });

  it('sendet bei DELETE weder Body noch Content-Type', async () => {
    const fetch = mockFetch(200, { ok: true });
    await api.deleteArticle(1, 2);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'DELETE', body: undefined, headers: undefined });
  });

  it('kommt mit Nicht-JSON-Fehlern zurecht', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(api.groups()).rejects.toMatchObject({ status: 502, message: 'Fehler 502' });
  });

  it('ruft alle Endpunkte mit der richtigen Methode auf', async () => {
    const fetch = mockFetch(200, {});
    const input = { section: 'notes', path: '', title: 't', bodyMd: '', visibility: 'public' } as const;
    await api.me();
    await api.logout();
    await api.createGroup('g');
    await api.members(1);
    await api.invite(1, 'b@test.de');
    await api.setRole(1, 2, 'gm');
    await api.removeMember(1, 2);
    await api.article(1, 3);
    await api.createArticle(1, input);
    await api.updateArticle(1, 3, input);
    await api.deleteArticle(1, 3);
    await api.folders(1, 'notes');
    await api.createFolder(1, 'notes', 'a');
    await api.renameFolder(1, 'notes', 'a', 'b');
    await api.sheet(1, 3);
    await api.createSheet(1, 3, {} as never);
    await api.saveSheet(1, 3, {} as never, 1);
    await api.saveSheetState(1, 3, {} as never, 1);
    await api.deleteSheet(1, 3);
    await api.skills(1);
    await api.saveSkills(1, []);
    await api.applyPreset(1, 2);
    await api.presets();
    await api.createPreset({} as never);
    await api.updatePreset(2, {} as never);
    await api.deletePreset(2);
    expect(fetch.mock.calls.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
      'GET /api/auth/me',
      'POST /api/auth/logout',
      'POST /api/groups',
      'GET /api/groups/1/members',
      'POST /api/groups/1/members',
      'PATCH /api/groups/1/members/2',
      'DELETE /api/groups/1/members/2',
      'GET /api/groups/1/articles/3',
      'POST /api/groups/1/articles',
      'PUT /api/groups/1/articles/3',
      'DELETE /api/groups/1/articles/3',
      'GET /api/groups/1/folders?section=notes',
      'POST /api/groups/1/folders',
      'PATCH /api/groups/1/folders',
      'GET /api/groups/1/articles/3/sheet',
      'POST /api/groups/1/articles/3/sheet',
      'PUT /api/groups/1/articles/3/sheet',
      'PUT /api/groups/1/articles/3/sheet/state',
      'DELETE /api/groups/1/articles/3/sheet',
      'GET /api/groups/1/skills',
      'PUT /api/groups/1/skills',
      'POST /api/groups/1/skills/from-preset',
      'GET /api/presets',
      'POST /api/presets',
      'PUT /api/presets/2',
      'DELETE /api/presets/2',
    ]);
  });
});
