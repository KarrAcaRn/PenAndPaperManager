import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, api as realApi } from '../src/lib/api.ts';
import { loadSession, logout, reloadGroups, session, verifyLoginCode } from '../src/lib/session.svelte.ts';
import { GM, gmGroup, mockApi, signIn } from './helpers.ts';

let api: ReturnType<typeof mockApi>;
beforeEach(() => {
  api = mockApi();
  session.ready = false;
});

describe('session', () => {
  it('lädt ohne Login keine Gruppen', async () => {
    api.me.mockResolvedValue({ user: null });
    await loadSession();
    expect(session).toMatchObject({ user: null, groups: [], ready: true });
    expect(api.groups).not.toHaveBeenCalled();
  });

  it('lädt nach dem Login per Code Nutzer und Gruppen', async () => {
    api.verifyCode.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([gmGroup]);
    await verifyLoginCode(GM.email, '123456');
    expect(api.verifyCode).toHaveBeenCalledWith(GM.email, '123456');
    expect(session).toMatchObject({ user: GM, groups: [gmGroup], ready: true });
  });

  it('bleibt bei falschem Code ausgeloggt', async () => {
    signIn(null);
    api.verifyCode.mockRejectedValue(new ApiFailure(401, 'Code ungültig'));
    await expect(verifyLoginCode(GM.email, '000000')).rejects.toBeInstanceOf(ApiFailure);
    expect(session.user).toBeNull();
    expect(api.groups).not.toHaveBeenCalled();
  });

  it('räumt beim Logout auf und zeigt den Login', async () => {
    signIn(GM, [gmGroup]);
    location.hash = '#/g/7/notes';
    api.logout.mockResolvedValue({});
    await logout();
    expect(session).toMatchObject({ user: null, groups: [] });
    expect(location.hash).toBe('#/login');
  });

  it('wirkt lokal auch dann, wenn der Server beim Logout nicht antwortet', async () => {
    signIn(GM, [gmGroup]);
    api.logout.mockRejectedValue(new Error('offline'));
    await logout();
    expect(session).toMatchObject({ user: null, groups: [] });
  });

  it('reloadGroups aktualisiert die Gruppen', async () => {
    signIn(GM, []);
    api.groups.mockResolvedValue([gmGroup]);
    await reloadGroups();
    expect(session.groups).toEqual([gmGroup]);
  });
});

describe('Reaktion auf Auth-Fehler der API', () => {
  // Hier läuft die echte api gegen ein gefälschtes fetch
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  const respond = (responses: Record<string, [number, unknown]>) =>
    vi.stubGlobal('fetch', async (url: string) => {
      const [status, body] = responses[url] ?? [500, { error: `unerwartet: ${url}` }];
      return new Response(JSON.stringify(body), { status });
    });

  it('zeigt bei 401 wieder den Login', async () => {
    signIn(GM, [gmGroup]);
    respond({ '/api/groups/7/members': [401, { error: 'Nicht eingeloggt' }] });
    await expect(realApi.members(7)).rejects.toBeInstanceOf(ApiFailure);
    expect(session).toMatchObject({ user: null, groups: [] });
  });

  it('lädt bei 403 die Gruppen neu, damit geänderte Rollen sichtbar werden', async () => {
    signIn(GM, [gmGroup]);
    respond({
      '/api/groups/7/members': [403, { error: 'Nur für Spielleiter' }],
      '/api/groups': [200, [{ ...gmGroup, role: 'player' }]],
    });
    await expect(realApi.members(7)).rejects.toBeInstanceOf(ApiFailure);
    await vi.waitFor(() => expect(session.groups[0].role).toBe('player'));
  });

  it('ignoriert 403 ohne Login und Fehler beim Nachladen', async () => {
    signIn(null);
    respond({ '/api/groups/7/members': [403, { error: 'x' }] });
    await expect(realApi.members(7)).rejects.toBeInstanceOf(ApiFailure);
    signIn(GM, [gmGroup]);
    await expect(realApi.members(7)).rejects.toBeInstanceOf(ApiFailure);
    expect(session.groups).toEqual([gmGroup]);
  });
});
