import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
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
import FolderTree from '../src/lib/FolderTree.svelte';
import MarkdownEditorHarness from './MarkdownEditorHarness.svelte';
import { notifyContentChanged } from '../src/lib/content.svelte.ts';
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

  it('meldet einen nicht erreichbaren Server', async () => {
    api.me.mockRejectedValue(new Error('Failed to fetch'));
    render(App);
    expect(await screen.findByText(/Server nicht erreichbar/)).toBeTruthy();
  });
});

describe('Login', () => {
  it('loggt ein und zeigt Fehler an', async () => {
    api.login.mockRejectedValueOnce(new ApiFailure(400, 'Ungültige Eingabe'));
    render(Login);
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'sl@test.de');
    await user.click(screen.getByRole('button', { name: 'Einloggen' }));
    expect(await screen.findByText('Ungültige Eingabe')).toBeTruthy();

    api.login.mockResolvedValue(GM);
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Einloggen' }));
    await waitFor(() => expect(session.user).toEqual(GM));
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
    expect(nav()).toEqual(['Testrunde', 'Charaktere', 'Notizen']);
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
    renderLayout('#/g/7/manage');
    expect(nav()).toContain('Spielleiter');
    expect(screen.getByRole('link', { name: 'Gruppe verwalten' })).toBeTruthy();
    expect(await screen.findByText('Mitglieder')).toBeTruthy();
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
    await waitFor(() => expect(api.updateArticle).toHaveBeenCalledWith(7, 1, expect.objectContaining({ title: 'Wirtin', path: 'bar' })));
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
