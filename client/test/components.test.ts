import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { ApiFailure } from '../src/lib/api.ts';
import { parseHash, router } from '../src/lib/router.svelte.ts';
import { session } from '../src/lib/session.svelte.ts';
import App from '../src/App.svelte';
import Login from '../src/routes/Login.svelte';
import GroupSelect from '../src/routes/GroupSelect.svelte';
import GroupLayout from '../src/routes/GroupLayout.svelte';
import FolderView from '../src/routes/FolderView.svelte';
import ArticleView from '../src/routes/ArticleView.svelte';
import ArticleEdit from '../src/routes/ArticleEdit.svelte';
import GmManage from '../src/routes/GmManage.svelte';
import Rules from '../src/routes/Rules.svelte';
import FolderTree from '../src/lib/FolderTree.svelte';
import MarkdownEditorHarness from './MarkdownEditorHarness.svelte';
import { contentChanges, notifyContentChanged } from '../src/lib/content.svelte.ts';
import { showNotice } from '../src/lib/notice.svelte.ts';
import { MAX_RULE_HITS, type Rulebook } from '@pnp/shared';
import {
  GM,
  PLAYER,
  folder,
  fullArticle,
  gmGroup,
  member,
  mockApi,
  mockEmptyFolder,
  playerGroup,
  signIn,
  summary,
} from './helpers.ts';

// jsdom kennt kein Layout; ProseMirror fragt beim Scrollen zur Auswahl nach Rechtecken
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: () => DOMRectList }[]) {
  proto.getClientRects ??= emptyRects;
}
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const renderLayout = (hash: string) => render(GroupLayout, { route: parseHash(hash) as never });

let api: ReturnType<typeof mockApi>;
const user = userEvent.setup();

beforeEach(() => {
  api = mockApi();
  api.presets.mockResolvedValue([]);
  location.hash = '#/';
  router.route = { name: 'groups' };
  signIn(null);
});

describe('App', () => {
  beforeEach(() => {
    session.ready = false;
  });

  it('zeigt ohne Session den Login', async () => {
    api.me.mockResolvedValue({ user: null });
    render(App);
    expect(await screen.findByLabelText('E-Mail-Adresse')).toBeTruthy();
  });

  it('zeigt mit Session die Gruppenauswahl', async () => {
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([gmGroup]);
    render(App);
    expect(await screen.findByText('Deine Gruppen')).toBeTruthy();
  });

  it('zeigt erst einen Ladezustand und dann die Gruppe aus der URL', async () => {
    router.route = parseHash('#/g/7/notes');
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([gmGroup]);
    mockEmptyFolder(api);
    render(App);
    expect(screen.getByText('Lade …')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Testrunde' })).toBeTruthy();
  });

  it('zeigt Hinweise auf jeder Seite, bis man sie ausblendet', async () => {
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([gmGroup]);
    showNotice('Etwas ist schiefgegangen');
    render(App);
    expect(await screen.findByText('Deine Gruppen')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Etwas ist schiefgegangen');
    await user.click(screen.getByRole('button', { name: 'Ausblenden' }));
    expect(screen.queryByText('Etwas ist schiefgegangen')).toBeNull();
  });

  it('meldet einen nicht erreichbaren Server', async () => {
    api.me.mockRejectedValue(new Error('Failed to fetch'));
    render(App);
    expect(await screen.findByText(/Server nicht erreichbar/)).toBeTruthy();
  });

  it('leitet ohne Session zum Login um und nach dem Login zurück zur angefragten Seite', async () => {
    location.hash = '#/g/7/notes';
    router.route = parseHash(location.hash);
    api.me.mockResolvedValue({ user: null });
    api.requestCode.mockResolvedValue(null);
    api.verifyCode.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([gmGroup]);
    mockEmptyFolder(api);
    render(App);
    await waitFor(() => expect(location.hash).toBe('#/login/%23%2Fg%2F7%2Fnotes'));
    await waitFor(() => expect(router.route).toEqual({ name: 'login', next: '#/g/7/notes' }));
    await user.type(screen.getByLabelText('E-Mail-Adresse'), GM.email);
    await user.click(screen.getByRole('button', { name: 'Code senden' }));
    await user.type(await screen.findByLabelText('Code aus der E-Mail'), '123456{Enter}');
    await waitFor(() => expect(location.hash).toBe('#/g/7/notes'));
    expect(await screen.findByRole('link', { name: 'Testrunde' })).toBeTruthy();
  });

  it('schickt Eingeloggte von der Login-Seite weiter', async () => {
    location.hash = '#/login';
    router.route = parseHash(location.hash);
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([gmGroup]);
    render(App);
    expect(await screen.findByText('Deine Gruppen')).toBeTruthy();
    expect(location.hash).toBe('#/');
  });

  it('zeigt nach dem Logout wieder den Login', async () => {
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([gmGroup]);
    api.logout.mockResolvedValue({});
    render(App);
    await user.click(await screen.findByRole('button', { name: 'Logout' }));
    expect(await screen.findByLabelText('E-Mail-Adresse')).toBeTruthy();
    await waitFor(() => expect(location.hash).toBe('#/login'));
  });
});

describe('Login', () => {
  const sendCodeFor = async (email: string) => {
    await user.type(screen.getByLabelText('E-Mail-Adresse'), email);
    await user.click(screen.getByRole('button', { name: 'Code senden' }));
  };

  describe('Schritt 1: E-Mail', () => {
    it('prüft die E-Mail-Adresse, bevor ein Code angefordert wird', async () => {
      render(Login);
      await sendCodeFor('keine-adresse');
      expect(screen.getByRole('alert').textContent).toBe('Bitte gib eine gültige E-Mail-Adresse ein.');
      expect(screen.getByLabelText('E-Mail-Adresse').getAttribute('aria-invalid')).toBe('true');
      expect(api.requestCode).not.toHaveBeenCalled();
    });

    it('fordert einen Code an und wechselt zur Code-Eingabe', async () => {
      api.requestCode.mockResolvedValue(null);
      render(Login);
      await sendCodeFor('  sl@test.de ');
      expect(api.requestCode).toHaveBeenCalledWith('sl@test.de');
      const input = await screen.findByLabelText('Code aus der E-Mail');
      expect(screen.getByText('sl@test.de')).toBeTruthy();
      expect(input.getAttribute('inputmode')).toBe('numeric');
      expect(input.getAttribute('autocomplete')).toBe('one-time-code');
      expect(input.getAttribute('maxlength')).toBe('6');
      await waitFor(() => expect(document.activeElement).toBe(input));
    });

    it('meldet zu viele Anfragen und andere Fehler', async () => {
      api.requestCode.mockRejectedValueOnce(new ApiFailure(429, 'Too Many Requests'));
      render(Login);
      await sendCodeFor('sl@test.de');
      expect((await screen.findByRole('alert')).textContent).toMatch(/Zu viele Anfragen/);
      api.requestCode.mockRejectedValueOnce(new Error('Failed to fetch'));
      await user.click(screen.getByRole('button', { name: 'Code senden' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Failed to fetch'));
      expect(screen.queryByLabelText('Code aus der E-Mail')).toBeNull();
    });

    it('sperrt den Button, solange der Code angefordert wird', async () => {
      let resolve!: () => void;
      api.requestCode.mockReturnValue(new Promise<void>((r) => (resolve = r)));
      render(Login);
      await sendCodeFor('sl@test.de');
      const button = screen.getByRole('button', { name: 'Code wird gesendet …' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      resolve();
      expect(await screen.findByLabelText('Code aus der E-Mail')).toBeTruthy();
    });
  });

  describe('Schritt 2: Code', () => {
    beforeEach(() => {
      api.requestCode.mockResolvedValue(null);
    });

    it('loggt mit dem Code ein und lässt nur Ziffern zu', async () => {
      api.verifyCode.mockResolvedValue({ user: GM });
      api.groups.mockResolvedValue([gmGroup]);
      render(Login);
      await sendCodeFor('sl@test.de');
      const input = (await screen.findByLabelText('Code aus der E-Mail')) as HTMLInputElement;
      await user.type(input, '12 34-56');
      expect(input.value).toBe('123456');
      await user.click(screen.getByRole('button', { name: 'Einloggen' }));
      await waitFor(() => expect(session.user).toEqual(GM));
      expect(api.verifyCode).toHaveBeenCalledWith('sl@test.de', '123456');
      expect(session.groups).toEqual([gmGroup]);
    });

    it('verlangt sechs Ziffern und meldet ungültige oder abgelaufene Codes', async () => {
      render(Login);
      await sendCodeFor('sl@test.de');
      const input = await screen.findByLabelText('Code aus der E-Mail');
      await user.type(input, '123');
      await user.click(screen.getByRole('button', { name: 'Einloggen' }));
      expect(screen.getByRole('alert').textContent).toBe('Der Code besteht aus 6 Ziffern.');
      expect(api.verifyCode).not.toHaveBeenCalled();

      for (const status of [400, 401]) {
        api.verifyCode.mockRejectedValueOnce(new ApiFailure(status, 'x'));
        await user.clear(input);
        await user.type(input, '999999{Enter}');
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Code ungültig oder abgelaufen.'));
      }
      api.verifyCode.mockRejectedValueOnce(new ApiFailure(429, 'x'));
      await user.click(screen.getByRole('button', { name: 'Einloggen' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Zu viele Anfragen/));
      expect(session.user).toBeNull();
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('bietet "Code erneut senden" erst nach 60 Sekunden wieder an', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(Login);
        await fireEvent.input(screen.getByLabelText('E-Mail-Adresse'), { target: { value: 'sl@test.de' } });
        await fireEvent.click(screen.getByRole('button', { name: 'Code senden' }));
        const resend = (await screen.findByRole('button', { name: /Code erneut senden/ })) as HTMLButtonElement;
        expect(resend.disabled).toBe(true);
        expect(resend.textContent).toMatch(/\(60 s\)/);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(resend.textContent).toMatch(/\([23]\d s\)/);
        await vi.advanceTimersByTimeAsync(31_000);
        expect(resend.disabled).toBe(false);
        expect(resend.textContent?.trim()).toBe('Code erneut senden');

        await fireEvent.click(resend);
        await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Ein neuer Code ist unterwegs.'));
        expect(api.requestCode).toHaveBeenCalledTimes(2);
        expect(api.requestCode).toHaveBeenLastCalledWith('sl@test.de');
        expect(resend.disabled).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('meldet Fehler beim erneuten Senden', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(Login);
        await fireEvent.input(screen.getByLabelText('E-Mail-Adresse'), { target: { value: 'sl@test.de' } });
        await fireEvent.click(screen.getByRole('button', { name: 'Code senden' }));
        const resend = (await screen.findByRole('button', { name: /Code erneut senden/ })) as HTMLButtonElement;
        await vi.advanceTimersByTimeAsync(61_000);
        api.requestCode.mockRejectedValueOnce(new ApiFailure(429, 'x'));
        await fireEvent.click(resend);
        await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Zu viele Anfragen/));
        expect(resend.disabled).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('kehrt mit "Andere E-Mail verwenden" zur E-Mail-Eingabe zurück', async () => {
      render(Login);
      await sendCodeFor('sl@test.de');
      await user.click(await screen.findByRole('button', { name: 'Andere E-Mail verwenden' }));
      const email = screen.getByLabelText('E-Mail-Adresse') as HTMLInputElement;
      expect(email.value).toBe('sl@test.de');
      expect(screen.queryByRole('alert')).toBeNull();
      await user.clear(email);
      await sendCodeFor('alice@test.de');
      expect(await screen.findByText('alice@test.de')).toBeTruthy();
      expect((screen.getByLabelText('Code aus der E-Mail') as HTMLInputElement).value).toBe('');
    });
  });
});

describe('GroupSelect', () => {
  it('bietet ohne Gruppen direkt das Anlegen an und wechselt in die neue Gruppe', async () => {
    signIn(GM, []);
    api.createGroup.mockResolvedValue(gmGroup);
    api.groups.mockResolvedValue([gmGroup]);
    render(GroupSelect);
    await user.type(screen.getByLabelText('Name der neuen Gruppe'), 'Testrunde');
    await user.click(screen.getByRole('button', { name: 'Gruppe anlegen' }));
    await waitFor(() => expect(location.hash).toBe('#/g/7/characters'));
    expect(api.createGroup).toHaveBeenCalledWith('Testrunde', undefined);
  });

  it('listet Gruppen mit Rolle und blendet das Formular erst auf Klick ein', async () => {
    signIn(PLAYER, [playerGroup]);
    render(GroupSelect);
    expect(screen.getByRole('link', { name: 'Testrunde' }).getAttribute('href')).toBe('#/g/7/characters');
    expect(screen.getByText('Spieler')).toBeTruthy();
    expect(screen.queryByLabelText('Name der neuen Gruppe')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Neue Gruppe anlegen' }));
    expect(screen.getByLabelText('Name der neuen Gruppe')).toBeTruthy();
  });

  it('loggt über das Benutzermenü aus', async () => {
    signIn(PLAYER, [playerGroup]);
    api.logout.mockResolvedValue({});
    render(GroupSelect);
    expect(screen.getByText(PLAYER.email)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(session.user).toBeNull());
  });

  it('zeigt Fehler beim Anlegen', async () => {
    signIn(GM, []);
    api.createGroup.mockRejectedValue(new ApiFailure(400, 'Name fehlt'));
    render(GroupSelect);
    await user.type(screen.getByLabelText('Name der neuen Gruppe'), 'x');
    await user.click(screen.getByRole('button', { name: 'Gruppe anlegen' }));
    expect(await screen.findByText('Name fehlt')).toBeTruthy();
  });
});

describe('GroupLayout', () => {
  beforeEach(() => {
    mockEmptyFolder(api);
    api.members.mockResolvedValue([]);
  });

  const nav = () => within(screen.getByRole('banner')).getAllByRole('link').map((a) => a.textContent);

  it('versteckt den Bereich Spielleiter vor Spielern', () => {
    signIn(PLAYER, [playerGroup]);
    renderLayout('#/g/7/notes');
    expect(nav()).toEqual(['Testrunde', 'Charaktere', 'Notizen', 'Regelwerk']);
  });

  it('zeigt das Regelwerk allen Mitgliedern, ohne Ordnerbaum und SL-Unterpunkte', async () => {
    api.rulebooks.mockResolvedValue([]);
    signIn(PLAYER, [playerGroup]);
    renderLayout('#/g/7/rules');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Regelwerk' }).classList.contains('active')).toBe(true);
    expect(await screen.findByText(/noch kein Regelwerk eingespielt/)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Spielleiter' })).toBeNull();
    expect(api.folders).not.toHaveBeenCalled();
  });

  it('sperrt Spieler auch bei direktem Aufruf aus', () => {
    signIn(PLAYER, [playerGroup]);
    for (const hash of ['#/g/7/gm', '#/g/7/manage']) {
      const { unmount } = renderLayout(hash);
      expect(screen.getByText('Dieser Bereich ist nur für Spielleiter.')).toBeTruthy();
      unmount();
    }
    expect(api.articles).not.toHaveBeenCalled();
    expect(api.members).not.toHaveBeenCalled();
  });

  it('zeigt Spielleitern den Bereich samt Verwaltungs-Tab', async () => {
    signIn(GM, [gmGroup]);
    const view = renderLayout('#/g/7/manage');
    expect(nav()).toContain('Spielleiter');
    // Die Unterpunkte stehen als eigene Zeile in der Navigation, der aktive ist markiert
    const sub = within(screen.getByRole('banner')).getByRole('navigation', { name: 'Spielleiter' });
    expect(within(sub).getAllByRole('link').map((a) => a.textContent)).toEqual(['Artikel', 'Fertigkeiten', 'Gruppe verwalten']);
    expect(within(sub).getByRole('link', { name: 'Gruppe verwalten' }).classList.contains('active')).toBe(true);
    expect(await screen.findByText('Mitglieder')).toBeTruthy();
    view.unmount();
    // In anderen Bereichen gibt es keine Unterpunkte
    renderLayout('#/g/7/notes');
    expect(screen.queryByRole('navigation', { name: 'Spielleiter' })).toBeNull();
  });

  it('meldet unbekannte Gruppen', () => {
    signIn(GM, []);
    renderLayout('#/g/99/notes');
    expect(screen.getByText(/gibt es nicht oder du bist kein Mitglied/)).toBeTruthy();
  });

  it('rendert Artikelansicht, Editor und Neu-Formular', async () => {
    signIn(GM, [gmGroup]);
    api.article.mockResolvedValue(fullArticle());
    const view = renderLayout('#/g/7/notes/a/1');
    expect(await screen.findByRole('heading', { name: 'Wirt' })).toBeTruthy();
    view.unmount();
    const edit = renderLayout('#/g/7/notes/a/1/edit');
    expect(await screen.findByRole('heading', { name: 'Artikel bearbeiten' })).toBeTruthy();
    edit.unmount();
    renderLayout('#/g/7/notes/new/bar');
    expect(await screen.findByRole('heading', { name: 'Neuer Artikel' })).toBeTruthy();
  });

  it('zeigt in allen Artikelbereichen links den Ordnerbaum, beim Verwalten nicht', async () => {
    signIn(GM, [gmGroup]);
    for (const hash of ['#/g/7/characters', '#/g/7/notes', '#/g/7/gm']) {
      const { unmount } = renderLayout(hash);
      expect(await screen.findByRole('navigation', { name: 'Ordnerbaum' })).toBeTruthy();
      unmount();
    }
    renderLayout('#/g/7/manage');
    expect(await screen.findByText('Mitglieder')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Ordnerbaum' })).toBeNull();
  });

  it('baut die Seite beim Gruppenwechsel per Link neu auf', async () => {
    const otherGroup = { ...gmGroup, id: 8, name: 'Andere Runde' };
    signIn(GM, [gmGroup, otherGroup]);
    const view = renderLayout('#/g/7/notes');
    await waitFor(() => expect(api.articles).toHaveBeenCalledWith(7, 'notes', ''));
    await view.rerender({ route: parseHash('#/g/8/notes') as never });
    await waitFor(() => expect(api.articles).toHaveBeenCalledWith(8, 'notes', ''));
    expect(api.folders).toHaveBeenCalledWith(8, 'notes');
  });

  it('zeigt den gewählten Artikel rechts neben dem Baum, Bearbeiten oben rechts', async () => {
    signIn(GM, [gmGroup]);
    api.folders.mockResolvedValue([folder('NPCs')]);
    api.articles.mockResolvedValue([summary({ path: 'NPCs' })]);
    api.article.mockResolvedValue(fullArticle({ path: 'NPCs' }));
    renderLayout('#/g/7/notes/a/1');
    const tree = await screen.findByRole('navigation', { name: 'Ordnerbaum' });
    // Ordner des gewählten Artikels ist aufgeklappt und der Artikel markiert
    const current = await within(tree).findByRole('link', { name: /Wirt/ });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('heading', { name: 'Wirt' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bearbeiten' }).getAttribute('href')).toBe('#/g/7/notes/a/1/edit');
  });
});

describe('Rules', () => {
  const book = (over: Partial<Rulebook> = {}): Rulebook => ({
    id: 1,
    title: 'Fate Kompakt',
    pageCount: 98,
    importedAt: '2026-10-12 09:00:00',
    chapters: [
      { title: 'Konflikte', page: 51, label: '50', level: 0 },
      { title: 'Angreifen', page: 52, label: '51', level: 1 },
    ],
    ...over,
  });
  const frame = () => screen.getByTitle('Fate Kompakt') as HTMLIFrameElement;

  it('zeigt das Inhaltsverzeichnis und springt im PDF auf die Seite', async () => {
    api.rulebooks.mockResolvedValue([book()]);
    render(Rules);
    const toc = await screen.findByRole('list', { name: 'Inhaltsverzeichnis' });
    expect(frame().getAttribute('src')).toBe('/api/rulebooks/1/pdf?v=2026-10-12+09%3A00%3A00#page=1');
    await userEvent.click(within(toc).getByRole('button', { name: /Angreifen/ }));
    expect(frame().getAttribute('src')).toBe('/api/rulebooks/1/pdf?v=2026-10-12+09%3A00%3A00#page=52');
    expect(screen.getByRole('link', { name: 'PDF in neuem Tab öffnen' }).getAttribute('href')).toBe('/api/rulebooks/1/pdf?v=2026-10-12+09%3A00%3A00#page=52');
  });

  it('sucht beim Tippen, markiert Treffer und kehrt bei leerer Suche zum Inhaltsverzeichnis zurück', async () => {
    api.rulebooks.mockResolvedValue([book()]);
    api.searchRules.mockResolvedValue([
      { rulebookId: 1, page: 56, label: '55', chapter: 'Konflikte', snippet: [{ text: 'eine ', mark: false }, { text: 'Konsequenz', mark: true }, { text: ' heilen', mark: false }] },
    ]);
    render(Rules);
    const input = await screen.findByRole('searchbox', { name: 'Im Regelwerk suchen' });
    await userEvent.type(input, 'konseq');
    const results = await screen.findByRole('list', { name: 'Suchergebnisse' });
    expect(api.searchRules).toHaveBeenLastCalledWith('konseq', 1);
    expect(within(results).getByText('Konsequenz').tagName).toBe('MARK');
    expect(screen.getByText('1 Treffer')).toBeTruthy();
    await userEvent.click(within(results).getByRole('button', { name: /S\. 55/ }));
    expect(frame().getAttribute('src')).toBe('/api/rulebooks/1/pdf?v=2026-10-12+09%3A00%3A00#page=56');

    await userEvent.clear(input);
    expect(await screen.findByRole('list', { name: 'Inhaltsverzeichnis' })).toBeTruthy();
  });

  it('wechselt das Regelwerk, springt auf Seite 1 und sucht dort neu', async () => {
    api.rulebooks.mockResolvedValue([book(), book({ id: 2, title: 'Turbo-Fate', chapters: [] })]);
    api.searchRules.mockResolvedValue([]);
    render(Rules);
    await userEvent.click(within(await screen.findByRole('list', { name: 'Inhaltsverzeichnis' })).getByRole('button', { name: /Angreifen/ }));
    await userEvent.type(screen.getByRole('searchbox'), 'Stress{Enter}');
    await userEvent.selectOptions(screen.getByLabelText('Regelwerk'), 'Turbo-Fate');
    expect(api.searchRules).toHaveBeenLastCalledWith('Stress', 2);
    expect((screen.getByTitle('Turbo-Fate') as HTMLIFrameElement).getAttribute('src')).toMatch(/^\/api\/rulebooks\/2\/pdf\?.*#page=1$/);
  });

  it('zeigt Fehler veralteter Suchen nicht an und blendet Fehler beim Leeren aus', async () => {
    api.rulebooks.mockResolvedValue([book()]);
    let failOld!: (err: Error) => void;
    api.searchRules
      .mockReturnValueOnce(new Promise((_, reject) => (failOld = reject)))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiFailure(500, 'Interner Fehler'));
    render(Rules);
    const input = await screen.findByRole('searchbox');
    await userEvent.type(input, 'a{Enter}');
    await userEvent.type(input, 'b{Enter}');
    expect(await screen.findByText('Keine Treffer.')).toBeTruthy();
    failOld(new ApiFailure(500, 'Alt'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('Alt')).toBeNull();
    await userEvent.type(input, 'c{Enter}');
    expect(await screen.findByText('Interner Fehler')).toBeTruthy();
    await userEvent.clear(input);
    await userEvent.type(input, '{Enter}');
    expect(screen.queryByText('Interner Fehler')).toBeNull();
  });

  it('weist auf gekappte Trefferlisten hin', async () => {
    api.rulebooks.mockResolvedValue([book()]);
    api.searchRules.mockResolvedValue(
      Array.from({ length: MAX_RULE_HITS }, (_, i) => ({ rulebookId: 1, page: i + 1, label: String(i), chapter: '', snippet: [] })),
    );
    render(Rules);
    await userEvent.type(await screen.findByRole('searchbox'), 'a{Enter}');
    expect(await screen.findByText(/Die 50 besten Treffer/)).toBeTruthy();
  });

  it('meldet Such- und Ladefehler', async () => {
    api.rulebooks.mockResolvedValue([book()]);
    api.searchRules.mockRejectedValue(new ApiFailure(400, 'Ungültige Eingabe'));
    render(Rules);
    await userEvent.type(await screen.findByRole('searchbox'), 'x{Enter}');
    expect(await screen.findByText('Ungültige Eingabe')).toBeTruthy();

    api.rulebooks.mockRejectedValue(new ApiFailure(500, 'Interner Fehler'));
    render(Rules);
    expect(await screen.findByText('Interner Fehler')).toBeTruthy();
  });
});

describe('FolderTree', () => {
  const tree = () => screen.getByRole('navigation', { name: 'Ordnerbaum' });

  it('klappt Ordner auf und zu und sortiert Ordner vor Artikeln', async () => {
    api.folders.mockResolvedValue([folder('Orte'), folder('NPCs'), folder('NPCs/Adel')]);
    api.articles.mockResolvedValue([
      summary({ id: 2, title: 'Zwerg', path: 'NPCs' }),
      summary({ id: 3, title: 'Graf', path: 'NPCs/Adel' }),
      summary({ id: 4, title: 'Notiz', path: '' }),
      summary({ id: 5, title: 'Held', path: '', hasSheet: true }),
    ]);
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: '' } });
    await within(tree()).findByRole('link', { name: /NPCs/ });
    const names = () => within(tree()).getAllByRole('link').map((a) => a.textContent!.trim());
    expect(names()).toEqual(['Notizen', '📁 NPCs', '📁 Orte', '🎭 Held', '📄 Notiz']);
    expect(within(tree()).getAllByRole('link', { name: /NPCs/ })[0].getAttribute('href')).toBe('#/g/7/notes/f/NPCs');

    await user.click(screen.getByRole('button', { name: 'NPCs aufklappen' }));
    expect(names()).toEqual(['Notizen', '📁 NPCs', '📁 Adel', '📄 Zwerg', '📁 Orte', '🎭 Held', '📄 Notiz']);
    expect(screen.queryByRole('button', { name: /Orte/ })).toBeNull(); // leerer Ordner ohne Pfeil
    await user.click(screen.getByRole('button', { name: 'NPCs zuklappen' }));
    expect(names()).not.toContain('📁 Adel');
  });

  it('klappt den Weg zum gewählten Ordner auf und lädt nach Änderungen neu', async () => {
    api.folders.mockResolvedValue([folder('a'), folder('a/b'), folder('a/b/c')]);
    api.articles.mockResolvedValue([]);
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'a/b' } });
    const link = await within(tree()).findByRole('link', { name: 'b' });
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(within(tree()).getByRole('link', { name: 'c' })).toBeTruthy();

    api.articles.mockResolvedValue([summary({ id: 9, title: 'Neu', path: 'a/b' })]);
    notifyContentChanged();
    expect(await within(tree()).findByRole('link', { name: /Neu/ })).toBeTruthy();
    expect(api.folders).toHaveBeenCalledTimes(2);
  });

  it('zeigt Stift und Plus nur am gewählten Ordner, den Stift nur mit Verwaltungsrecht', async () => {
    api.folders.mockResolvedValue([folder('a'), folder('b', false)]);
    api.articles.mockResolvedValue([]);
    const view = render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'a' } });
    await within(tree()).findByRole('link', { name: /b/ });
    expect(screen.getByRole('button', { name: 'a umbenennen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'In a anlegen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^b / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'In b anlegen' })).toBeNull();
    view.unmount();

    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'b' } });
    await within(tree()).findByRole('link', { name: /b/ });
    expect(screen.queryByRole('button', { name: 'b umbenennen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'In b anlegen' })).toBeTruthy();
  });

  it('benennt den gewählten Ordner im Baum um', async () => {
    api.folders.mockResolvedValue([folder('Orte'), folder('Orte/Städte')]);
    api.articles.mockResolvedValue([]);
    api.renameFolder.mockResolvedValue(folder('Orte/Dörfer'));
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte/Städte' } });
    await user.click(await screen.findByRole('button', { name: 'Städte umbenennen' }));
    const input = screen.getByRole('textbox', { name: 'Städte umbenennen' }) as HTMLInputElement;
    expect(input.value).toBe('Städte');
    await user.clear(input);
    await user.type(input, 'Dörfer{Enter}');
    await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith(7, 'notes', 'Orte/Städte', 'Orte/Dörfer'));
    expect(api.renameFolder).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(location.hash).toBe('#/g/7/notes/f/Orte/D%C3%B6rfer'));
  });

  it('bricht das Umbenennen mit Escape oder unverändertem Namen ab', async () => {
    api.folders.mockResolvedValue([folder('Orte')]);
    api.articles.mockResolvedValue([]);
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte' } });
    await user.click(await screen.findByRole('button', { name: 'Orte umbenennen' }));
    await user.type(screen.getByRole('textbox'), 'x{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Orte umbenennen' }));
    await user.type(screen.getByRole('textbox'), '{Enter}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.renameFolder).not.toHaveBeenCalled();
  });

  it('legt über das Plus-Menü einen Unterordner an', async () => {
    api.folders.mockResolvedValue([folder('Orte')]);
    api.articles.mockResolvedValue([]);
    api.createFolder.mockResolvedValue(folder('Orte/Höhlen'));
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte' } });
    await user.click(await screen.findByRole('button', { name: 'In Orte anlegen' }));
    expect(screen.getByRole('button', { name: 'Artikel' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ordner' }));
    expect(screen.queryByRole('button', { name: 'Artikel' })).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Neuer Ordner in Orte' }), ' Höhlen {Enter}');
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith(7, 'notes', 'Orte/Höhlen'));
    await waitFor(() => expect(location.hash).toBe('#/g/7/notes/f/Orte/H%C3%B6hlen'));
  });

  it('legt über das Plus-Menü einen Artikel im Ordner bzw. auf oberster Ebene an', async () => {
    api.folders.mockResolvedValue([folder('Orte')]);
    api.articles.mockResolvedValue([]);
    const view = render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte' } });
    await user.click(await screen.findByRole('button', { name: 'In Orte anlegen' }));
    await user.click(screen.getByRole('button', { name: 'Artikel' }));
    expect(location.hash).toBe('#/g/7/notes/new/Orte');
    view.unmount();

    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: '' } });
    expect(screen.queryByRole('button', { name: /umbenennen/ })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'In Notizen anlegen' }));
    await user.click(screen.getByRole('button', { name: 'Artikel' }));
    expect(location.hash).toBe('#/g/7/notes/new');
  });

  it('schließt das Plus-Menü bei Klick daneben und mit Escape', async () => {
    api.folders.mockResolvedValue([folder('Orte')]);
    api.articles.mockResolvedValue([]);
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte' } });
    const plus = await screen.findByRole('button', { name: 'In Orte anlegen' });
    await user.click(plus);
    expect(plus.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Ordner' })).toBeNull();
    expect(document.activeElement).toBe(plus);
    await user.click(plus);
    await user.click(document.body);
    expect(screen.queryByRole('button', { name: 'Ordner' })).toBeNull();
    await user.click(plus);
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ordner' })).toBeNull());
  });

  it('bricht beim Verlassen des Felds ab und speichert nicht doppelt', async () => {
    api.folders.mockResolvedValue([folder('Orte')]);
    api.articles.mockResolvedValue([]);
    let finish!: () => void;
    api.renameFolder.mockImplementation(() => new Promise((resolve) => (finish = () => resolve(folder('Neu')))));
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte' } });
    await user.click(await screen.findByRole('button', { name: 'Orte umbenennen' }));
    await user.type(screen.getByRole('textbox'), 'X');
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.renameFolder).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Orte umbenennen' }));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Neu{Enter}');
    // während des Speicherns: weder Blur noch zweites Enter lösen etwas aus
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    finish();
    await waitFor(() => expect(location.hash).toBe('#/g/7/notes/f/Neu'));
    expect(api.renameFolder).toHaveBeenCalledTimes(1);
  });

  it('lehnt „/“ im Namen ab und legt auf oberster Ebene ohne Präfix an', async () => {
    api.folders.mockResolvedValue([]);
    api.articles.mockResolvedValue([]);
    api.createFolder.mockResolvedValue(folder('Neu'));
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: '' } });
    await user.click(await screen.findByRole('button', { name: 'In Notizen anlegen' }));
    await user.click(screen.getByRole('button', { name: 'Ordner' }));
    const input = screen.getByRole('textbox', { name: 'Neuer Ordner' });
    await user.type(input, 'a/b{Enter}');
    expect(screen.getByText(/darf kein „\/“ enthalten/)).toBeTruthy();
    expect(api.createFolder).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'Neu{Enter}');
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith(7, 'notes', 'Neu'));
  });

  it('schließt Menü und Eingabefeld, wenn sich die Auswahl ändert, und bringt den Fokus nach Escape zurück', async () => {
    api.folders.mockResolvedValue([folder('a'), folder('b')]);
    api.articles.mockResolvedValue([]);
    const view = render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'a' } });
    await user.click(await screen.findByRole('button', { name: 'a umbenennen' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'a umbenennen' }));

    await user.click(screen.getByRole('button', { name: 'a umbenennen' }));
    await view.rerender({ group: gmGroup, section: 'notes', current: { folder: 'b' } });
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'In b anlegen' }));
    await view.rerender({ group: gmGroup, section: 'notes', current: { folder: 'a' } });
    expect(screen.queryByRole('button', { name: 'Ordner' })).toBeNull();
  });

  it('zeigt Fehler beim Anlegen und behält die Eingabe', async () => {
    api.folders.mockResolvedValue([folder('Orte')]);
    api.articles.mockResolvedValue([]);
    api.createFolder.mockRejectedValue(new ApiFailure(400, 'Ungültiger Name'));
    render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte' } });
    await user.click(await screen.findByRole('button', { name: 'In Orte anlegen' }));
    await user.click(screen.getByRole('button', { name: 'Ordner' }));
    await user.type(screen.getByRole('textbox'), 'x{Enter}');
    expect(await screen.findByText('Ungültiger Name')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('x');
  });

  describe('Drag & Drop', () => {
    const node = (name: string | RegExp) => within(tree()).getByRole('link', { name }).closest('.node') as HTMLElement;
    const dragOnto = async (from: HTMLElement, to: HTMLElement) => {
      await fireEvent.dragStart(from);
      await fireEvent.dragEnter(to);
      await fireEvent.dragOver(to);
      await fireEvent.drop(to);
      await fireEvent.dragEnd(from);
    };

    it('verschiebt einen Ordner in einen anderen und wandert mit der Auswahl mit', async () => {
      api.folders.mockResolvedValue([folder('Orte'), folder('Orte/Höhlen'), folder('NPCs')]);
      api.articles.mockResolvedValue([]);
      api.renameFolder.mockResolvedValue(folder('NPCs/Orte'));
      render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte/Höhlen' } });
      await within(tree()).findByRole('link', { name: /Höhlen/ });
      const before = contentChanges.version;
      await dragOnto(node(/Orte/), node(/NPCs/));
      await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith(7, 'notes', 'Orte', 'NPCs/Orte'));
      await waitFor(() => expect(location.hash).toBe('#/g/7/notes/f/NPCs/Orte/H%C3%B6hlen'));
      expect(contentChanges.version).toBeGreaterThan(before);
    });

    it('verschiebt einen Artikel in einen Ordner und auf die oberste Ebene', async () => {
      api.folders.mockResolvedValue([folder('Orte')]);
      api.articles.mockResolvedValue([summary({ id: 4, title: 'Wirt', path: '' }), summary({ id: 5, title: 'Burg', path: 'Orte' })]);
      api.moveArticle.mockResolvedValue(fullArticle());
      render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte' } });
      await within(tree()).findByRole('link', { name: /Burg/ });
      await dragOnto(node(/Wirt/), node(/Orte/));
      await waitFor(() => expect(api.moveArticle).toHaveBeenCalledWith(7, 4, 'Orte'));
      const root = within(tree()).getByRole('link', { name: 'Notizen' }).closest('.node') as HTMLElement;
      await dragOnto(node(/Burg/), root);
      await waitFor(() => expect(api.moveArticle).toHaveBeenCalledWith(7, 5, ''));
    });

    it('lässt nur Erlaubtes ziehen und ablegen', async () => {
      api.folders.mockResolvedValue([folder('Orte'), folder('Orte/Höhlen'), folder('Fremd', false)]);
      api.articles.mockResolvedValue([summary({ id: 4, title: 'Fremder', path: '', canEdit: false })]);
      render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte/Höhlen' } });
      await within(tree()).findByRole('link', { name: /Höhlen/ });
      expect(node(/Fremd$/).getAttribute('draggable')).toBe('false');
      expect(node(/Fremder/).getAttribute('draggable')).toBe('false');
      expect(node(/Orte/).getAttribute('draggable')).toBe('true');
      // in sich selbst, in den eigenen Unterordner und dorthin, wo es schon liegt: kein Ablegen
      await dragOnto(node(/Orte/), node(/Orte/));
      await dragOnto(node(/Orte/), node(/Höhlen/));
      await dragOnto(node(/Höhlen/), node(/Orte/));
      // gesperrte Einträge: auch ein Ziehen, das doch startet (z.B. über einen Kindknoten), wird abgebrochen
      expect(await fireEvent.dragStart(node(/Fremd$/))).toBe(false);
      await dragOnto(node(/Fremd$/), node(/Orte/));
      await dragOnto(node(/Fremder/), node(/Orte/));
      expect(api.renameFolder).not.toHaveBeenCalled();
      expect(api.moveArticle).not.toHaveBeenCalled();
      // Links im Baum ziehen nicht ihre URL mit
      expect(within(tree()).getByRole('link', { name: /Orte/ }).getAttribute('draggable')).toBe('false');
    });

    it('ignoriert Ablegen ohne Ziehvorgang aus dem Baum (z.B. Dateien) und während eines laufenden Verschiebens', async () => {
      api.folders.mockResolvedValue([folder('Orte'), folder('NPCs'), folder('Sessions')]);
      api.articles.mockResolvedValue([]);
      let finish!: () => void;
      api.renameFolder.mockImplementation(() => new Promise((resolve) => (finish = () => resolve(folder('NPCs/Orte')))));
      render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: '' } });
      await within(tree()).findByRole('link', { name: /NPCs/ });
      // fremder Ziehvorgang: abgefangen (kein Öffnen der Datei), aber keine Aktion
      expect(await fireEvent.dragOver(node(/Orte/))).toBe(false);
      await fireEvent.drop(node(/Orte/));
      expect(api.renameFolder).not.toHaveBeenCalled();

      await dragOnto(node(/Orte/), node(/NPCs/));
      await dragOnto(node(/Sessions/), node(/NPCs/));
      expect(api.renameFolder).toHaveBeenCalledTimes(1);
      finish();
    });

    it('wandert aus dem Formular für einen neuen Artikel nicht weg', async () => {
      api.folders.mockResolvedValue([folder('Orte'), folder('NPCs')]);
      api.articles.mockResolvedValue([]);
      api.renameFolder.mockResolvedValue(folder('NPCs/Orte'));
      location.hash = '#/g/7/notes/new/Orte';
      render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: 'Orte', newArticle: true } });
      await within(tree()).findByRole('link', { name: /NPCs/ });
      await dragOnto(node(/Orte/), node(/NPCs/));
      await waitFor(() => expect(api.renameFolder).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(location.hash).toBe('#/g/7/notes/new/Orte');
    });

    it('klappt einen Ordner auf, über dem man verweilt, und behält aufgeklappte Ordner nach dem Verschieben', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        api.folders.mockResolvedValue([folder('Orte'), folder('Orte/Höhlen'), folder('NPCs'), folder('NPCs/Adel')]);
        api.articles.mockResolvedValue([]);
        api.renameFolder.mockResolvedValue(folder('NPCs/Orte'));
        render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: '' } });
        await within(tree()).findByRole('link', { name: /NPCs/ });
        await fireEvent.click(screen.getByRole('button', { name: 'Orte aufklappen' }));
        await fireEvent.dragStart(node(/Orte/));
        await fireEvent.dragOver(node(/NPCs/));
        await fireEvent.dragOver(node(/NPCs/));
        expect(within(tree()).queryByRole('link', { name: /Adel/ })).toBeNull();
        await vi.advanceTimersByTimeAsync(800);
        expect(within(tree()).getByRole('link', { name: /Adel/ })).toBeTruthy();
        await fireEvent.drop(node(/NPCs/));
        await waitFor(() => expect(api.renameFolder).toHaveBeenCalled());
        api.folders.mockResolvedValue([folder('NPCs'), folder('NPCs/Adel'), folder('NPCs/Orte'), folder('NPCs/Orte/Höhlen')]);
        notifyContentChanged();
        expect(await within(tree()).findByRole('link', { name: /Höhlen/ })).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('markiert das Ablageziel und zeigt Fehler', async () => {
      api.folders.mockResolvedValue([folder('Orte'), folder('NPCs')]);
      api.articles.mockResolvedValue([]);
      api.renameFolder.mockRejectedValue(new ApiFailure(409, 'Es gibt bereits einen Ordner mit diesem Namen'));
      render(FolderTree, { group: gmGroup, section: 'notes', current: { folder: '' } });
      await within(tree()).findByRole('link', { name: /NPCs/ });
      await fireEvent.dragStart(node(/Orte/));
      await fireEvent.dragOver(node(/NPCs/));
      expect(node(/NPCs/).classList.contains('drop-target')).toBe(true);
      // über einem Artikel/Zwischenraum bzw. beim Verlassen des Baums verschwindet die Markierung
      await fireEvent.dragOver(tree());
      expect(node(/NPCs/).classList.contains('drop-target')).toBe(false);
      await fireEvent.dragOver(node(/NPCs/));
      await fireEvent.dragLeave(tree());
      expect(node(/NPCs/).classList.contains('drop-target')).toBe(false);
      await fireEvent.dragOver(node(/NPCs/));
      await fireEvent.drop(node(/NPCs/));
      expect(node(/NPCs/).classList.contains('drop-target')).toBe(false);
      expect(await screen.findByText('Es gibt bereits einen Ordner mit diesem Namen')).toBeTruthy();
    });
  });

  it('zeigt Ladefehler', async () => {
    api.folders.mockRejectedValue(new ApiFailure(403, 'Nur für Spielleiter'));
    api.articles.mockResolvedValue([]);
    render(FolderTree, { group: gmGroup, section: 'gm', current: { folder: '' } });
    expect(await screen.findByText('Nur für Spielleiter')).toBeTruthy();
  });
});

describe('MarkdownEditor', () => {
  const setup = (value: string) => {
    render(MarkdownEditorHarness, { value });
    return {
      get value() {
        return screen.getByTestId('value').textContent;
      },
    };
  };
  const editor = () => screen.getByRole('textbox', { name: 'Text' });

  it('formatiert per Werkzeugleiste und liefert Markdown zurück', async () => {
    const props = setup('Hallo Welt');
    await waitFor(() => expect(editor().textContent).toBe('Hallo Welt'));
    await user.click(screen.getByRole('button', { name: 'Überschrift 2' }));
    expect(props.value).toBe('## Hallo Welt');
    expect(screen.getByRole('button', { name: 'Überschrift 2' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Aufzählung' }));
    expect(props.value).toBe('- Hallo Welt');
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    expect(props.value).not.toMatch(/^- /); // je nach Tempo werden beide Schritte zusammen rückgängig gemacht
  });

  it('startet Texte mit HTML im Markdown-Modus und warnt vor dem Wechsel', async () => {
    const props = setup('Text mit <u>HTML</u>');
    const source = screen.getByLabelText('Text (Markdown-Quelltext)') as HTMLTextAreaElement;
    expect(source.value).toBe('Text mit <u>HTML</u>');
    expect(screen.getByText(/enthält HTML/)).toBeTruthy();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByLabelText('Text (Markdown-Quelltext)')).toBeTruthy();
    expect(props.value).toBe('Text mit <u>HTML</u>');
  });

  it('wechselt in den Markdown-Quelltext und übernimmt Änderungen beim Zurückwechseln', async () => {
    const props = setup('**fett**');
    await waitFor(() => expect(within(editor()).getByText('fett').tagName).toBe('STRONG'));
    await user.click(screen.getByRole('button', { name: 'Markdown' }));
    const source = screen.getByLabelText('Text (Markdown-Quelltext)') as HTMLTextAreaElement;
    expect(source.value).toBe('**fett**');
    expect((screen.getByRole('button', { name: 'Fett' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(source);
    await user.type(source, '# Neu');
    await user.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(within(editor()).getByRole('heading', { name: 'Neu' })).toBeTruthy();
    expect(props.value).toBe('# Neu');
  });

  it('fügt Links und Tabellen ein und zeigt Tabellenwerkzeuge nur in Tabellen', async () => {
    const props = setup('Karte');
    await waitFor(() => expect(editor().textContent).toBe('Karte'));
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('https://example.org');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(props.value).toBe('Karte');
    expect(screen.queryByRole('toolbar', { name: 'Tabelle' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tabelle' }));
    expect(props.value).toContain('| --- | --- | --- |');
    expect(screen.getByRole('toolbar', { name: 'Tabelle' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tabelle löschen' }));
    expect(props.value).not.toContain('|');
  });
});

describe('FolderView', () => {
  const props = { group: gmGroup, section: 'notes' as const, path: 'bar' };

  it('zeigt Breadcrumb, direkte Unterordner und Artikel', async () => {
    api.folders.mockResolvedValue([folder('bar'), folder('bar/foo'), folder('bar/foo/tief'), folder('anders')]);
    api.articles.mockResolvedValue([summary({ section: 'notes', path: 'bar', title: 'Taverne', visibility: 'private_gm' })]);
    render(FolderView, props);
    expect(await screen.findByRole('link', { name: 'foo' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'tief' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'anders' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Taverne' }).getAttribute('href')).toBe('#/g/7/notes/a/1');
    expect(screen.getByText('Privat & Spielleiter')).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Pfad' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['Notizen', 'bar']);
    expect(screen.getByRole('link', { name: 'Neuer Artikel' }).getAttribute('href')).toBe('#/g/7/notes/new/bar');
    expect(api.articles).toHaveBeenCalledWith(7, 'notes', 'bar');
  });

  it('lädt nach Änderungen anderswo (z.B. Drag & Drop im Ordnerbaum) neu', async () => {
    api.folders.mockResolvedValue([folder('bar')]);
    api.articles.mockResolvedValue([]);
    render(FolderView, props);
    expect(await screen.findByText(/Hier ist noch nichts/)).toBeTruthy();
    api.articles.mockResolvedValue([summary({ path: 'bar', title: 'Hereingezogen' })]);
    notifyContentChanged();
    expect(await screen.findByRole('link', { name: 'Hereingezogen' })).toBeTruthy();
  });

  it('findet den Ordner auch über einen nicht normalisierten Link', async () => {
    api.folders.mockResolvedValue([folder('B\u00e4r'), folder('B\u00e4r/kind')]);
    api.articles.mockResolvedValue([]);
    render(FolderView, { ...props, path: ' Ba\u0308r /' });
    expect(await screen.findByRole('link', { name: 'kind' })).toBeTruthy();
    expect(api.articles).toHaveBeenCalledWith(7, 'notes', 'B\u00e4r');
  });

  it('behandelt ungültige Pfade wie fehlende Ordner', async () => {
    mockEmptyFolder(api);
    render(FolderView, { ...props, path: 'a/../b' });
    expect(await screen.findByText(/Diesen Ordner gibt es nicht/)).toBeTruthy();
  });

  it('zeigt Leer- und Fehlzustand', async () => {
    api.folders.mockResolvedValue([folder('bar')]);
    api.articles.mockResolvedValue([]);
    const first = render(FolderView, props);
    expect(await screen.findByText(/Hier ist noch nichts/)).toBeTruthy();
    first.unmount();

    api.folders.mockResolvedValue([]);
    render(FolderView, props);
    expect(await screen.findByText(/Diesen Ordner gibt es nicht/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zurück zu Notizen' }));
    expect(location.hash).toBe('#/g/7/notes');
  });

  it('legt Ordner im aktuellen Ordner an', async () => {
    api.folders.mockResolvedValue([folder('bar')]);
    api.articles.mockResolvedValue([]);
    api.createFolder.mockResolvedValue(folder('bar/neu'));
    render(FolderView, props);
    await user.click(screen.getByRole('button', { name: 'Neuer Ordner' }));
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(api.createFolder).not.toHaveBeenCalled(); // leerer Name
    await user.type(screen.getByPlaceholderText('Ordnername'), ' neu ');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith(7, 'notes', 'bar/neu'));
    await waitFor(() => expect(screen.queryByPlaceholderText('Ordnername')).toBeNull());
    expect(api.folders).toHaveBeenCalledTimes(2);
  });

  it('bricht das Anlegen ab', async () => {
    api.folders.mockResolvedValue([folder('bar')]);
    api.articles.mockResolvedValue([]);
    render(FolderView, props);
    await user.click(screen.getByRole('button', { name: 'Neuer Ordner' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByPlaceholderText('Ordnername')).toBeNull();
  });

  it('benennt um und löscht nur verwaltbare Ordner, zeigt Serverfehler', async () => {
    api.folders.mockResolvedValue([folder('bar'), folder('bar/meins'), folder('bar/fremd', false)]);
    api.articles.mockResolvedValue([]);
    api.renameFolder.mockResolvedValue(folder('bar/neu'));
    api.deleteFolder.mockRejectedValue(new ApiFailure(409, 'Ordner ist nicht leer'));
    render(FolderView, props);
    await screen.findByRole('link', { name: 'meins' });
    expect(screen.getAllByRole('button', { name: 'Umbenennen' })).toHaveLength(1);

    const prompt = vi.spyOn(window, 'prompt');
    prompt.mockReturnValueOnce(null);
    await user.click(screen.getByRole('button', { name: 'Umbenennen' }));
    prompt.mockReturnValueOnce('bar/meins');
    await user.click(screen.getByRole('button', { name: 'Umbenennen' }));
    expect(api.renameFolder).not.toHaveBeenCalled();
    prompt.mockReturnValueOnce('bar/neu');
    await user.click(screen.getByRole('button', { name: 'Umbenennen' }));
    await waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith(7, 'notes', 'bar/meins', 'bar/neu'));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(api.deleteFolder).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(await screen.findByText('Ordner ist nicht leer')).toBeTruthy();
  });

  it('zeigt Ladefehler ohne zusätzlichen Leer-Hinweis', async () => {
    api.folders.mockRejectedValue(new ApiFailure(403, 'Nur für Spielleiter'));
    api.articles.mockResolvedValue([]);
    render(FolderView, props);
    expect(await screen.findByText('Nur für Spielleiter')).toBeTruthy();
    expect(screen.queryByText(/Hier ist noch nichts/)).toBeNull();
    expect(screen.queryByText(/Diesen Ordner gibt es nicht/)).toBeNull();
  });
});

describe('ArticleView', () => {
  it('rendert bereinigtes Markdown und den Pfad', async () => {
    api.article.mockResolvedValue(fullArticle({ path: 'bar/foo', bodyMd: '# Hallo\n<script>window.x=1</script>' }));
    const { container } = render(ArticleView, { group: gmGroup, id: 1 });
    expect(await screen.findByRole('heading', { name: 'Hallo' })).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('link', { name: 'foo' }).getAttribute('href')).toBe('#/g/7/notes/f/bar/foo');
    expect(screen.getByRole('link', { name: 'Bearbeiten' }).getAttribute('href')).toBe('#/g/7/notes/a/1/edit');
  });

  it('versteckt Aktionen ohne Bearbeitungsrecht', async () => {
    api.article.mockResolvedValue(fullArticle({ canEdit: false }));
    render(ArticleView, { group: playerGroup, id: 1 });
    await screen.findByRole('heading', { name: 'Wirt' });
    expect(screen.queryByRole('link', { name: 'Bearbeiten' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Löschen' })).toBeNull();
  });

  it('löscht nach Rückfrage und kehrt in den Ordner zurück', async () => {
    api.article.mockResolvedValue(fullArticle({ path: 'bar' }));
    api.deleteArticle.mockResolvedValue({});
    render(ArticleView, { group: gmGroup, id: 1 });
    const button = await screen.findByRole('button', { name: 'Löschen' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(button);
    expect(api.deleteArticle).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    await user.click(button);
    await waitFor(() => expect(location.hash).toBe('#/g/7/notes/f/bar'));
  });

  it('zeigt Lade- und Löschfehler', async () => {
    api.article.mockRejectedValueOnce(new ApiFailure(404, 'Artikel nicht gefunden'));
    const first = render(ArticleView, { group: gmGroup, id: 1 });
    expect(await screen.findByText('Artikel nicht gefunden')).toBeTruthy();
    first.unmount();

    api.article.mockResolvedValue(fullArticle());
    api.deleteArticle.mockRejectedValue(new ApiFailure(403, 'Nicht erlaubt'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(ArticleView, { group: gmGroup, id: 1 });
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    expect(await screen.findByText('Nicht erlaubt')).toBeTruthy();
  });
});

describe('ArticleEdit', () => {
  beforeEach(() => {
    api.folders.mockResolvedValue([folder('bar')]);
  });

  it('legt einen Artikel im vorgegebenen Ordner an', async () => {
    signIn(PLAYER, [playerGroup]);
    api.createArticle.mockResolvedValue(fullArticle({ id: 5, section: 'notes' }));
    render(ArticleEdit, { group: playerGroup, section: 'notes', path: 'bar' });
    await user.type(await screen.findByLabelText('Titel'), 'Taverne');
    await user.click(screen.getByRole('button', { name: 'Markdown' }));
    await user.type(screen.getByLabelText('Text (Markdown-Quelltext)'), 'Bier');
    await user.selectOptions(screen.getByLabelText('Sichtbarkeit'), 'public');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(location.hash).toBe('#/g/7/notes/a/5'));
    expect(api.createArticle).toHaveBeenCalledWith(7, {
      section: 'notes',
      path: 'bar',
      title: 'Taverne',
      bodyMd: 'Bier',
      visibility: 'public',
    });
    expect((screen.getByRole('link', { name: 'Abbrechen' }) as HTMLAnchorElement).hash).toBe('#/g/7/notes/f/bar');
  });

  it('bietet Spielern den Bereich Spielleiter nicht an', async () => {
    signIn(PLAYER, [playerGroup]);
    render(ArticleEdit, { group: playerGroup, section: 'notes' });
    const options = within(await screen.findByLabelText('Bereich')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Charaktere', 'Notizen']);
  });

  it('lädt einen bestehenden Artikel und speichert Änderungen', async () => {
    signIn(PLAYER, [playerGroup]);
    api.article.mockResolvedValue(fullArticle({ path: 'bar' }));
    api.updateArticle.mockResolvedValue(fullArticle());
    render(ArticleEdit, { group: playerGroup, section: 'notes', id: 1 });
    const title = (await screen.findByLabelText('Titel')) as HTMLInputElement;
    expect(title.value).toBe('Wirt');
    expect((screen.getByLabelText('Ordner') as HTMLInputElement).value).toBe('bar');
    await user.clear(title);
    await user.type(title, 'Wirtin');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.updateArticle).toHaveBeenCalledWith(7, 1, expect.objectContaining({ title: 'Wirtin' })));
    // Ordner unverändert: nicht mitschicken, sonst holte das Formular einen inzwischen umbenannten Ordner zurück
    expect('path' in api.updateArticle.mock.calls[0][2]).toBe(false);
  });

  it('schickt den Ordner mit, wenn er geändert wurde', async () => {
    signIn(PLAYER, [playerGroup]);
    api.article.mockResolvedValue(fullArticle({ path: 'bar' }));
    api.updateArticle.mockResolvedValue(fullArticle({ path: 'baz' }));
    render(ArticleEdit, { group: playerGroup, section: 'notes', id: 1 });
    const folderInput = (await screen.findByLabelText('Ordner')) as HTMLInputElement;
    await user.clear(folderInput);
    await user.type(folderInput, 'baz');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.updateArticle).toHaveBeenCalledWith(7, 1, expect.objectContaining({ path: 'baz' })));
  });

  it('sperrt bei fremden Artikeln "Privat" und den Bereich Spielleiter', async () => {
    signIn(GM, [gmGroup]);
    api.article.mockResolvedValue(fullArticle({ authorId: PLAYER.id }));
    render(ArticleEdit, { group: gmGroup, section: 'notes', id: 1 });
    const select = await screen.findByLabelText('Sichtbarkeit');
    expect((within(select).getByRole('option', { name: 'Privat' }) as HTMLOptionElement).disabled).toBe(true);
    const sections = within(screen.getByLabelText('Bereich')).getAllByRole('option');
    expect(sections.map((o) => o.textContent)).toEqual(['Charaktere', 'Notizen']);
  });

  it('behält den Bereich Spielleiter bei fremden Artikeln, die schon dort liegen', async () => {
    signIn(GM, [gmGroup]);
    api.article.mockResolvedValue(fullArticle({ authorId: 99, section: 'gm' }));
    render(ArticleEdit, { group: gmGroup, section: 'gm', id: 1 });
    const select = (await screen.findByLabelText('Bereich')) as HTMLSelectElement;
    expect(select.value).toBe('gm');
  });

  it('zeigt ohne Bearbeitungsrecht kein Formular', async () => {
    signIn(PLAYER, [playerGroup]);
    api.article.mockResolvedValue(fullArticle({ canEdit: false }));
    render(ArticleEdit, { group: playerGroup, section: 'notes', id: 1 });
    expect(await screen.findByText('Du darfst diesen Artikel nicht bearbeiten')).toBeTruthy();
    expect(screen.queryByLabelText('Titel')).toBeNull();
    expect((screen.getByRole('link', { name: 'Zurück' }) as HTMLAnchorElement).hash).toBe('#/g/7/notes/a/1');
  });

  it('verwirft veraltete Ordnerlisten bei schnellem Bereichswechsel', async () => {
    signIn(GM, [gmGroup]);
    let resolveNotes!: (f: unknown) => void;
    api.folders.mockImplementation((_gid: number, section: string) =>
      section === 'notes' ? new Promise((resolve) => (resolveNotes = resolve)) : Promise.resolve([folder('neu')]),
    );
    const { container } = render(ArticleEdit, { group: gmGroup, section: 'notes' });
    await user.selectOptions(await screen.findByLabelText('Bereich'), 'characters');
    await waitFor(() => expect(container.querySelector('datalist option')?.getAttribute('value')).toBe('neu'));
    resolveNotes([folder('alt')]);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('datalist option')?.getAttribute('value')).toBe('neu');
  });

  it('zeigt den Text formatiert im Editor und lädt Ordner beim Bereichswechsel neu', async () => {
    signIn(GM, [gmGroup]);
    api.article.mockResolvedValue(fullArticle({ authorId: GM.id, bodyMd: '# Hallo\n\nText **fett**' }));
    api.updateArticle.mockResolvedValue(fullArticle());
    render(ArticleEdit, { group: gmGroup, section: 'notes', id: 1 });
    const editor = await screen.findByRole('textbox', { name: 'Text' });
    await waitFor(() => expect(within(editor).getByRole('heading', { name: 'Hallo' })).toBeTruthy());
    expect(within(editor).getByText('fett').tagName).toBe('STRONG');
    await user.selectOptions(screen.getByLabelText('Bereich'), 'gm');
    await waitFor(() => expect(api.folders).toHaveBeenLastCalledWith(7, 'gm'));
    // Unveränderter Text wird unverändert gespeichert
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.updateArticle).toHaveBeenCalledWith(7, 1, expect.objectContaining({ bodyMd: '# Hallo\n\nText **fett**' })));
  });

  it('bleibt benutzbar, wenn die Ordnerliste nicht lädt', async () => {
    signIn(GM, [gmGroup]);
    api.folders.mockImplementation(async () => {
      throw new ApiFailure(500, 'kaputt');
    });
    const { container } = render(ArticleEdit, { group: gmGroup, section: 'notes' });
    expect(await screen.findByLabelText('Titel')).toBeTruthy();
    expect(container.querySelectorAll('datalist option')).toHaveLength(0);
  });

  it('zeigt Lade- und Speicherfehler', async () => {
    signIn(GM, [gmGroup]);
    api.article.mockRejectedValueOnce(new ApiFailure(404, 'Artikel nicht gefunden'));
    const first = render(ArticleEdit, { group: gmGroup, section: 'notes', id: 1 });
    expect(await screen.findByText('Artikel nicht gefunden')).toBeTruthy();
    expect(screen.queryByLabelText('Titel')).toBeNull();
    first.unmount();

    api.createArticle.mockRejectedValue(new ApiFailure(400, 'Pfad zu lang'));
    render(ArticleEdit, { group: gmGroup, section: 'notes' });
    await user.type(await screen.findByLabelText('Titel'), 'x');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Pfad zu lang')).toBeTruthy();
  });
});

describe('GmManage', () => {
  beforeEach(() => {
    signIn(GM, [gmGroup]);
  });

  it('sperrt Aktionen für den letzten Spielleiter', async () => {
    api.members.mockResolvedValue([member(GM, 'gm'), member(PLAYER, 'player')]);
    render(GmManage, { group: gmGroup });
    expect(((await screen.findByRole('button', { name: 'Zum Spieler machen' })) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Verlassen' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Entfernen' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('lädt ein, befördert und entfernt', async () => {
    api.members.mockResolvedValue([member(GM, 'gm'), member(PLAYER, 'player')]);
    api.invite.mockResolvedValue(member({ id: 3, email: 'bob@test.de' }, 'player'));
    api.setRole.mockResolvedValue({});
    api.removeMember.mockResolvedValue({});
    render(GmManage, { group: gmGroup });
    const input = (await screen.findByPlaceholderText('E-Mail-Adresse des Spielers')) as HTMLInputElement;
    await user.type(input, 'bob@test.de');
    await user.click(screen.getByRole('button', { name: 'Einladen' }));
    await waitFor(() => expect(api.invite).toHaveBeenCalledWith(7, 'bob@test.de'));
    await waitFor(() => expect(input.value).toBe(''));

    await user.click(screen.getByRole('button', { name: 'Zum Spielleiter machen' }));
    await waitFor(() => expect(api.setRole).toHaveBeenCalledWith(7, PLAYER.id, 'gm'));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Entfernen' }));
    expect(api.removeMember).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(7, PLAYER.id));
  });

  it('verlässt nach eigener Degradierung den Bereich', async () => {
    api.members.mockResolvedValue([member(GM, 'gm'), member(PLAYER, 'gm')]);
    api.setRole.mockResolvedValue({});
    api.groups.mockResolvedValue([playerGroup]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(GmManage, { group: gmGroup });
    const [own] = await screen.findAllByRole('button', { name: 'Zum Spieler machen' });
    await user.click(own);
    expect(api.setRole).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    await user.click(own);
    await waitFor(() => expect(location.hash).toBe('#/g/7/characters'));
    expect(session.groups).toEqual([playerGroup]);
  });

  it('kehrt nach dem Austritt zur Gruppenauswahl zurück', async () => {
    api.members.mockResolvedValue([member(GM, 'gm'), member(PLAYER, 'gm')]);
    api.removeMember.mockResolvedValue({});
    api.groups.mockResolvedValue([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    location.hash = '#/g/7/manage';
    render(GmManage, { group: gmGroup });
    await user.click(await screen.findByRole('button', { name: 'Verlassen' }));
    await waitFor(() => expect(location.hash).toBe('#/'));
  });

  it('zeigt Fehler', async () => {
    api.members.mockResolvedValue([member(GM, 'gm'), member(PLAYER, 'player')]);
    api.setRole.mockRejectedValue(new ApiFailure(409, 'Die Gruppe braucht mindestens einen Spielleiter'));
    render(GmManage, { group: gmGroup });
    await user.click(await screen.findByRole('button', { name: 'Zum Spielleiter machen' }));
    expect(await screen.findByText('Die Gruppe braucht mindestens einen Spielleiter')).toBeTruthy();
  });
});

describe('ArticleView nach Verschieben', () => {
  it('zieht den Ordner im Pfad nach, ohne neu aufzubauen', async () => {
    api.article.mockResolvedValue(fullArticle({ path: 'alt' }));
    render(ArticleView, { group: gmGroup, id: 1 });
    const crumbs = () => within(screen.getByRole('navigation', { name: 'Pfad' })).getAllByRole('link').map((a) => a.textContent);
    await waitFor(() => expect(crumbs()).toContain('alt'));
    api.article.mockResolvedValue(fullArticle({ path: 'neu' }));
    notifyContentChanged();
    await waitFor(() => expect(crumbs()).toContain('neu'));
  });
});
