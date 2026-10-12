import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Article, Sheet, SheetData, Skill } from '@pnp/shared';
import { ApiFailure } from '../src/lib/api.ts';
import { parseHash, router } from '../src/lib/router.svelte.ts';
import { session } from '../src/lib/session.svelte.ts';
import { contentChanges } from '../src/lib/content.svelte.ts';
import { clearNotice, notice } from '../src/lib/notice.svelte.ts';
import App from '../src/App.svelte';
import CharacterSheet from '../src/lib/CharacterSheet.svelte';
import SkillListEditor from '../src/lib/SkillListEditor.svelte';
import ArticleView from '../src/routes/ArticleView.svelte';
import ArticleEdit from '../src/routes/ArticleEdit.svelte';
import FolderView from '../src/routes/FolderView.svelte';
import GroupSelect from '../src/routes/GroupSelect.svelte';
import GroupLayout from '../src/routes/GroupLayout.svelte';
import GmSkills from '../src/routes/GmSkills.svelte';
import Admin from '../src/routes/Admin.svelte';
import {
  ADMIN,
  GM,
  PLAYER,
  fullArticle,
  gmGroup,
  mockApi,
  mockEmptyFolder,
  playerGroup,
  presetFixture,
  sheetData,
  signIn,
  summary,
} from './helpers.ts';

let api: ReturnType<typeof mockApi>;
const user = userEvent.setup();
const sheetOf = (over: Partial<SheetData> = {}, version = 1): Sheet => ({ data: sheetData(over), version });
const SKILLS: Skill[] = [
  { id: 11, name: 'Athletik' },
  { id: 12, name: 'Wille' },
];

beforeEach(() => {
  clearNotice();
  api = mockApi();
  api.presets.mockResolvedValue([presetFixture()]);
  location.hash = '#/';
  router.route = { name: 'groups' };
  signIn(GM, [gmGroup]);
});

describe('CharacterSheet', () => {
  it('zeigt die Fertigkeiten der Gruppe mit ihren Werten', () => {
    render(CharacterSheet, { data: sheetData({ name: 'Zoë', skills: { 11: 3 } }), skills: SKILLS });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Zoë');
    expect((screen.getByLabelText(/Athletik/) as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText(/Wille/) as HTMLInputElement).value).toBe('');
    expect(screen.getAllByLabelText(/er Stress \d/)).toHaveLength(12);
    expect(screen.getByLabelText('Dilemma')).toBeTruthy();
  });

  it('meldet Änderungen und begrenzt Fertigkeitswerte', async () => {
    const data = sheetData();
    const onchange = vi.fn();
    render(CharacterSheet, { data, skills: SKILLS, editable: 'all', onchange });
    await user.type(screen.getByLabelText('Konzept'), 'Schmugglerin');
    await user.click(screen.getByLabelText('Körperlicher Stress 2'));
    expect(onchange).toHaveBeenCalled();

    const athletik = screen.getByLabelText(/Athletik/);
    await user.type(athletik, '99');
    expect(onchange).toHaveBeenCalled();
    await user.clear(athletik);
    await user.type(athletik, 'x');
  });

  const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;

  it('ist ohne Bearbeitungsrecht schreibgeschützt', () => {
    render(CharacterSheet, { data: sheetData(), skills: SKILLS, editable: 'none' });
    expect(field('Name').readOnly).toBe(true);
    expect(field('Stunts').readOnly).toBe(true);
    expect(field('Geistiger Stress 1').disabled).toBe(true);
    expect(field(/Mittlere/).readOnly).toBe(true);
  });

  it('lässt außerhalb des Bearbeiten-Modus nur den Zustand ändern', async () => {
    const onchange = vi.fn();
    const data = sheetData();
    render(CharacterSheet, { data, skills: SKILLS, editable: 'condition', onchange });
    await user.type(field('Name'), 'X');
    await user.type(field(/Athletik/), '3');
    expect(onchange).not.toHaveBeenCalled();
    expect(field('Name').value).toBe('');
    expect(field(/Athletik/).value).toBe('');
    for (const label of ['Name', 'Alter', 'Pronomen', 'Konzept', 'Stunts', 'Erholungsrate', /Athletik/]) {
      expect(field(label).readOnly, String(label)).toBe(true);
    }
    expect(field('Körperlicher Stress 1').disabled).toBe(false);
    expect(field(/Mittlere/).readOnly).toBe(false);
    await user.click(field('Körperlicher Stress 1'));
    await user.type(field(/Mittlere/), 'Prellung');
    expect(field('Körperlicher Stress 1').checked).toBe(true);
    expect(onchange).toHaveBeenCalled();
  });

  it('zeigt die Knöpfe für die Kästchenzahl nur im Bearbeiten-Modus', () => {
    const { container } = render(CharacterSheet, { data: sheetData({ stressBoxes: { physical: 2, mental: 6 } }), skills: SKILLS, editable: 'condition' });
    expect(screen.queryByRole('button', { name: /Stresskästchen/ })).toBeNull();
    expect(container.querySelectorAll('.track')[0].querySelectorAll('label.off')).toHaveLength(4);
    expect(container.querySelectorAll('.track')[1].querySelectorAll('label.off')).toHaveLength(0);
  });

  it('setzt viele Fertigkeiten zweispaltig und weist auf eine fehlende Liste hin', () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ id: i + 1, name: `Fertigkeit ${i + 1}` }));
    const dense = render(CharacterSheet, { data: sheetData(), skills: many });
    expect(dense.container.querySelector('.skills.dense')).toBeTruthy();
    dense.unmount();
    const empty = render(CharacterSheet, { data: sheetData(), skills: [] });
    expect(empty.container.querySelector('.skills.dense')).toBeNull();
    expect(screen.getByText(/noch keine Fertigkeiten festgelegt/)).toBeTruthy();
  });
});

describe('FATE-Bogen in der Ansicht', () => {
  /** Artikel mit Bogen in der Ansicht: nur Stress und Konsequenzen sind änderbar und werden sofort gespeichert */
  function renderView(over: Partial<Article> = {}, sheet = sheetOf()) {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true, ...over }));
    api.sheet.mockResolvedValue(sheet);
    api.skills.mockResolvedValue(SKILLS);
    return render(ArticleView, { group: gmGroup, id: 1 });
  }
  const savesOk = () =>
    api.saveSheet.mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
  const consequence = async () => (await screen.findByLabelText(/Mittlere/)) as HTMLInputElement;

  it('lässt nur den Zustand ändern und speichert ihn automatisch', async () => {
    savesOk();
    renderView({}, sheetOf({ name: 'Zoë' }));
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    expect(name.readOnly).toBe(true);
    expect((screen.getByLabelText('Konzept') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((screen.getByLabelText(/Athletik/) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText(/Stress und Konsequenzen werden automatisch gespeichert/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bogen entfernen' })).toBeNull();

    await user.click(screen.getByLabelText('Geistiger Stress 2'));
    await user.type(await consequence(), 'Angst');
    await waitFor(() => expect((api.saveSheet.mock.calls.at(-1)![2].data as SheetData).consequences.moderate).toBe('Angst'));
    const last = api.saveSheet.mock.calls.at(-1)!;
    expect(last.slice(0, 2)).toEqual([7, 1]);
    expect((last[2].data as SheetData).stress.mental[1]).toBe(true);
    expect((last[2].data as SheetData).name).toBe('Zoë');
    expect(await screen.findByText(/^Gespeichert/)).toBeTruthy();
  });

  it('holt ein fehlgeschlagenes Speichern beim Verlassen nach, auch ohne weitere Eingabe', async () => {
    api.saveSheet.mockRejectedValueOnce(new Error('Failed to fetch'));
    const view = renderView();
    await user.type(await consequence(), 'A');
    await screen.findByText(/Nicht gespeichert: Failed to fetch/);

    savesOk();
    view.unmount();
    expect(api.saveSheet).toHaveBeenCalledTimes(2);
    expect(api.saveSheet.mock.calls[1][2]).toMatchObject({ version: 1, data: { consequences: { moderate: 'A' } } });
  });

  it('meldet einen Fehler beim Nachspeichern nach dem Verlassen als Hinweis', async () => {
    api.saveSheet.mockRejectedValue(new Error('Failed to fetch'));
    const view = renderView({ title: 'Zoë' });
    await user.type(await consequence(), 'A');
    await screen.findByText(/Nicht gespeichert/);
    view.unmount();
    await waitFor(() => expect(notice.text).toMatch(/^FATE-Bogen „Zoë“: letzte Eingaben nicht gespeichert/));
  });

  it('speichert beim Schließen des Tabs sofort und fragt nach', async () => {
    savesOk();
    renderView();
    const field = await consequence();
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false); // nichts offen
    await user.type(field, 'A'); // Speichern erst nach Verzögerung geplant
    expect(unload()).toBe(true);
    expect(api.saveSheet).toHaveBeenCalledTimes(1);
  });

  it('speichert nach einem Gruppenwechsel per Link noch in die alte Gruppe', async () => {
    const other = { ...gmGroup, id: 8, name: 'Andere' };
    signIn(GM, [gmGroup, other]);
    api.folders.mockResolvedValue([]);
    api.articles.mockResolvedValue([]);
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue(SKILLS);
    let finishFirst!: (sheet: Sheet) => void;
    api.saveSheet
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
    const view = render(GroupLayout, { route: parseHash('#/g/7/characters/a/1') as never });
    const field = await consequence();
    await user.type(field, 'A');
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(1)); // läuft noch
    await user.type(field, 'B');
    await view.rerender({ route: parseHash('#/g/8/notes') as never });
    finishFirst(sheetOf({ name: 'A' }));
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(2));
    expect(api.saveSheet.mock.calls[1].slice(0, 2)).toEqual([7, 1]);
    expect(api.saveSheet.mock.calls[1][2]).toMatchObject({ data: { consequences: { moderate: 'AB' } } });
  });

  it('speichert beim Verlassen nicht erneut, wenn nichts aussteht', async () => {
    savesOk();
    const view = renderView();
    await user.type(await consequence(), 'A');
    await screen.findByText(/^Gespeichert/);
    view.unmount();
    expect(api.saveSheet).toHaveBeenCalledTimes(1);
  });

  it('zeigt Speicherfehler und speichert ausstehende Änderungen beim Verlassen', async () => {
    api.saveSheet.mockRejectedValueOnce(new ApiFailure(403, 'Du darfst diesen Bogen nicht bearbeiten'));
    const view = renderView();
    const field = await consequence();
    await user.type(field, 'A');
    expect(await screen.findByText(/Nicht gespeichert: Du darfst/)).toBeTruthy();

    savesOk();
    fireEvent.input(field, { target: { value: 'AB' } });
    view.unmount();
    expect(api.saveSheet).toHaveBeenCalledTimes(2);
  });

  it('speichert nie zweimal gleichzeitig und reicht die neue Version weiter', async () => {
    let finishFirst!: () => void;
    api.saveSheet
      .mockImplementationOnce((_g: number, _a: number, sheet: Sheet) => new Promise((resolve) => (finishFirst = () => resolve({ ...sheet, version: 6 }))))
      .mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
    renderView({}, sheetOf({}, 5));
    const field = await consequence();
    await user.type(field, 'A');
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(1));
    await user.type(field, 'B');
    await new Promise((r) => setTimeout(r, 500));
    expect(api.saveSheet).toHaveBeenCalledTimes(1);

    finishFirst();
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(2));
    expect(api.saveSheet.mock.calls[0][2].version).toBe(5);
    expect(api.saveSheet.mock.calls[1][2]).toMatchObject({ version: 6, data: { consequences: { moderate: 'AB' } } });
  });

  it('stoppt bei einem Konflikt, sperrt den Zustand und lädt auf Wunsch neu', async () => {
    api.saveSheet.mockRejectedValue(new ApiFailure(409, 'Der Bogen wurde inzwischen von jemand anderem geändert'));
    const view = renderView({}, sheetOf({ name: 'alt' }));
    api.sheet.mockResolvedValue(sheetOf({ consequences: { mild: '', moderate: 'vom Spieler', severe: '', mild2: '' } }, 3));
    const field = await consequence();
    await user.type(field, 'x');
    const reload = await screen.findByRole('button', { name: 'Neu laden' });
    expect(field.readOnly).toBe(true);
    expect((screen.getByLabelText('Körperlicher Stress 1') as HTMLInputElement).disabled).toBe(true);
    fireEvent.input(field, { target: { value: 'trotzdem' } });
    await new Promise((r) => setTimeout(r, 500));
    expect(api.saveSheet).toHaveBeenCalledTimes(1);

    await user.click(reload);
    await waitFor(() => expect(field.value).toBe('vom Spieler'));
    expect(field.readOnly).toBe(false);
    expect(screen.queryByRole('button', { name: 'Neu laden' })).toBeNull();
    view.unmount();
    expect(api.saveSheet).toHaveBeenCalledTimes(1);
  });

  it('meldet beim Verlassen Eingaben, die wegen eines Konflikts nicht gespeichert wurden', async () => {
    api.saveSheet.mockRejectedValue(new ApiFailure(409, 'Konflikt'));
    const view = renderView({ title: 'Zoë' });
    await user.type(await consequence(), 'A');
    await screen.findByRole('button', { name: 'Neu laden' });
    view.unmount();
    expect(notice.text).toMatch(/^FATE-Bogen „Zoë“: letzte Eingaben nicht gespeichert, er wurde inzwischen/);
    expect(api.saveSheet).toHaveBeenCalledTimes(1);
  });

  it('ist für Leser schreibgeschützt und ohne Bearbeiten-Aktionen', async () => {
    signIn(PLAYER, [playerGroup]);
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true, canEdit: false }));
    // auch ein unvollständig gespeicherter Bogen wird vollständig dargestellt
    api.sheet.mockResolvedValue({ version: 1, data: { name: 'Zoë' } as never });
    api.skills.mockResolvedValue(SKILLS);
    render(ArticleView, { group: playerGroup, id: 1 });
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).readOnly).toBe(true);
    // auch den Zustand nicht
    expect((screen.getByLabelText('Körperlicher Stress 1') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText(/automatisch gespeichert/)).toBeNull();
    expect(screen.getByRole('button', { name: /Drucken/ })).toBeTruthy();
  });

  it('druckt über den Browser', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderView();
    await user.click(await screen.findByRole('button', { name: /Drucken/ }));
    expect(print).toHaveBeenCalled();
  });

  it('bietet das Hinzufügen nur im Bearbeiten-Modus an', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'notes' }));
    render(ArticleView, { group: gmGroup, id: 1 });
    await screen.findByRole('heading', { name: 'Wirt' });
    expect(screen.queryByRole('button', { name: 'FATE-Bogen hinzufügen' })).toBeNull();
  });

  it('meldet Ladefehler des Bogens', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockRejectedValue(new ApiFailure(500, 'Interner Fehler'));
    api.skills.mockResolvedValue([]);
    render(ArticleView, { group: gmGroup, id: 1 });
    expect(await screen.findByText('Interner Fehler')).toBeTruthy();
  });

  it('ist in der Ordneransicht am Symbol erkennbar', async () => {
    api.folders.mockResolvedValue([]);
    api.articles.mockResolvedValue([summary({ id: 1, title: 'Zoë', hasSheet: true }), summary({ id: 2, title: 'Notiz' })]);
    render(FolderView, { group: gmGroup, section: 'notes', path: '' });
    await screen.findByRole('link', { name: 'Zoë' });
    expect(screen.getByTitle('mit FATE-Bogen').textContent).toBe('🎭');
    expect(screen.getAllByText('📄')).toHaveLength(1);
  });
});

describe('FATE-Bogen im Bearbeiten-Modus', () => {
  /** Bestehender Artikel im Bearbeiten-Modus; alle Felder des Bogens sind bearbeitbar */
  function renderEditing(over: Partial<Article> = {}, sheet = sheetOf()) {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true, ...over }));
    api.folders.mockResolvedValue([]);
    api.sheet.mockResolvedValue(sheet);
    api.skills.mockResolvedValue(SKILLS);
    api.updateArticle.mockImplementation(async (_g: number, id: number, input: object) => fullArticle({ id, ...input }));
    return render(ArticleEdit, { group: gmGroup, section: 'characters', id: 1 });
  }
  const saveButton = () => screen.getByRole('button', { name: 'Speichern' });
  const savesOk = () =>
    api.saveSheet.mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));

  it('steht vor dem Text und speichert erst mit „Speichern“', async () => {
    savesOk();
    renderEditing({}, sheetOf({ name: 'Zoë' }, 4));
    const athletik = (await screen.findByLabelText(/Athletik/)) as HTMLInputElement;
    expect(athletik.readOnly).toBe(false);
    // Reihenfolge wie in der Ansicht: Bogen, dann Text
    const textEditor = await screen.findByRole('textbox', { name: 'Text' });
    expect(athletik.compareDocumentPosition(textEditor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Drucken/ })).toBeNull();

    await user.type(athletik, '3');
    await user.type(screen.getByLabelText('Konzept'), 'Schmugglerin');
    await user.click(screen.getByRole('button', { name: 'Mehr geistige Stresskästchen' }));
    await new Promise((r) => setTimeout(r, 500));
    expect(api.saveSheet).not.toHaveBeenCalled();

    await user.click(saveButton());
    await waitFor(() => expect(location.hash).toBe('#/g/7/characters/a/1'));
    expect(api.updateArticle).toHaveBeenCalledTimes(1);
    expect(api.saveSheet).toHaveBeenCalledTimes(1);
    expect(api.saveSheet.mock.calls[0]).toEqual([
      7,
      1,
      {
        version: 4,
        data: expect.objectContaining({
          name: 'Zoë',
          skills: { 11: 3 },
          aspects: expect.objectContaining({ concept: 'Schmugglerin' }),
          stressBoxes: { physical: 4, mental: 5 },
        }),
      },
    ]);
  });

  it('ändert die Zahl der nutzbaren Stresskästchen je Leiste', async () => {
    renderEditing();
    await screen.findByLabelText('Name');
    const offBoxes = (track: number) => document.querySelectorAll('.track')[track].querySelectorAll('label.off').length;
    const more = () => screen.getByRole('button', { name: 'Mehr körperliche Stresskästchen' }) as HTMLButtonElement;
    const fewer = () => screen.getByRole('button', { name: 'Weniger geistige Stresskästchen' }) as HTMLButtonElement;
    expect(offBoxes(0)).toBe(2);
    await user.click(more());
    await user.click(more());
    expect(offBoxes(0)).toBe(0);
    expect(more().disabled).toBe(true);
    for (let i = 0; i < 3; i++) await user.click(fewer());
    expect(offBoxes(1)).toBe(5);
    expect(fewer().disabled).toBe(true);
    // gespeichert wird erst mit dem Artikel
    expect(api.saveSheet).not.toHaveBeenCalled();
  });

  it('verwirft Änderungen am Bogen beim Abbrechen', async () => {
    renderEditing();
    await user.type(await screen.findByLabelText('Name'), 'A');
    await user.click(screen.getByRole('link', { name: 'Abbrechen' }));
    expect(api.saveSheet).not.toHaveBeenCalled();
  });

  it('bleibt bei einem Konflikt im Formular und lädt den Bogen auf Wunsch neu', async () => {
    api.saveSheet.mockRejectedValue(new ApiFailure(409, 'Der Bogen wurde inzwischen von jemand anderem geändert'));
    location.hash = '#/g/7/characters/a/1/edit';
    renderEditing({}, sheetOf({ name: 'alt' }));
    await user.type(await screen.findByLabelText('Name'), 'x');
    await user.click(saveButton());
    expect(await screen.findByText(/^Artikel gespeichert, der FATE-Bogen aber nicht: Der Bogen wurde inzwischen/)).toBeTruthy();
    expect(location.hash).toBe('#/g/7/characters/a/1/edit');

    api.sheet.mockResolvedValue(sheetOf({ name: 'vom Spieler' }, 3));
    await user.click(screen.getByRole('button', { name: 'Bogen neu laden' }));
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('vom Spieler'));
    expect(screen.queryByRole('button', { name: 'Bogen neu laden' })).toBeNull();
    savesOk();
    await user.click(saveButton());
    await waitFor(() => expect(api.saveSheet).toHaveBeenLastCalledWith(7, 1, expect.objectContaining({ version: 3 })));
  });

  it('lädt erst, wenn die Ansicht den Zustand fertig gespeichert hat', async () => {
    api.folders.mockResolvedValue([]);
    api.articles.mockResolvedValue([]);
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValueOnce(sheetOf({}, 1)).mockResolvedValue(sheetOf({ name: 'neu' }, 2));
    api.skills.mockResolvedValue(SKILLS);
    let finishSave!: () => void;
    api.saveSheet.mockImplementation((_g: number, _a: number, sheet: Sheet) => new Promise((resolve) => (finishSave = () => resolve({ ...sheet, version: 2 }))));
    const view = render(GroupLayout, { route: parseHash('#/g/7/characters/a/1') as never });
    await user.type(await screen.findByLabelText(/Mittlere/), 'A');
    // sofort "Bearbeiten": das Speichern läuft erst beim Abbau der Ansicht los
    await view.rerender({ route: parseHash('#/g/7/characters/a/1/edit') as never });
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.sheet).toHaveBeenCalledTimes(1);
    finishSave();
    await waitFor(() => expect(api.sheet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('neu'));
  });

  it('fügt einen Bogen hinzu, der erst mit dem Artikel angelegt wird', async () => {
    renderEditing({ section: 'notes', hasSheet: false, title: 'Wirt' });
    api.createSheet.mockResolvedValue(sheetOf());
    await user.click(await screen.findByRole('button', { name: 'FATE-Bogen hinzufügen' }));
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    expect(name.value).toBe('Wirt');
    await user.type(screen.getByLabelText('Konzept'), 'Wirt mit Geheimnis');
    expect(api.createSheet).not.toHaveBeenCalled();

    const before = contentChanges.version;
    await user.click(saveButton());
    await waitFor(() => expect(location.hash).toBe('#/g/7/notes/a/1'));
    expect(api.createSheet).toHaveBeenCalledWith(7, 1, expect.objectContaining({ name: 'Wirt', aspects: expect.objectContaining({ concept: 'Wirt mit Geheimnis' }) }));
    expect(contentChanges.version).toBeGreaterThan(before); // Ordnerbaum zeigt das Bogen-Symbol
  });

  it('verwirft einen noch nicht gespeicherten Bogen ohne Rückfrage', async () => {
    renderEditing({ section: 'notes', hasSheet: false });
    const confirm = vi.spyOn(window, 'confirm');
    await user.click(await screen.findByRole('button', { name: 'FATE-Bogen hinzufügen' }));
    await user.click(await screen.findByRole('button', { name: 'Bogen entfernen' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Konzept')).toBeNull();
    expect(screen.getByRole('button', { name: 'FATE-Bogen hinzufügen' })).toBeTruthy();
  });

  it('entfernt einen vorhandenen Bogen nach Rückfrage erst beim Speichern, „Doch behalten“ holt ihn zurück', async () => {
    api.deleteSheet.mockResolvedValue({});
    renderEditing({}, sheetOf({ name: 'Zoë' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const removeButton = await screen.findByRole('button', { name: 'Bogen entfernen' });
    await user.click(removeButton);
    expect(screen.getByLabelText('Name')).toBeTruthy();

    confirm.mockReturnValue(true);
    await user.click(removeButton);
    expect(screen.queryByLabelText('Name')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Doch behalten' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Zoë');

    await user.click(screen.getByRole('button', { name: 'Bogen entfernen' }));
    expect(screen.getByText(/wird beim Speichern entfernt/)).toBeTruthy();
    expect(api.deleteSheet).not.toHaveBeenCalled();
    await user.click(saveButton());
    await waitFor(() => expect(location.hash).toBe('#/g/7/characters/a/1'));
    expect(api.deleteSheet).toHaveBeenCalledWith(7, 1);
    // Bleibt der Bereich, erst den Artikel speichern: scheitert das, ist der Bogen noch da
    expect(api.updateArticle.mock.invocationCallOrder[0]).toBeLessThan(api.deleteSheet.mock.invocationCallOrder[0]);
    expect(api.saveSheet).not.toHaveBeenCalled();
  });

  it('löscht den Bogen vor dem Verschieben in einen Bereich ohne Bögen und sagt es, wenn das Verschieben scheitert', async () => {
    api.deleteSheet.mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderEditing({ authorId: GM.id });
    api.updateArticle.mockRejectedValueOnce(new ApiFailure(400, 'Ungültiger Pfad'));
    await user.click(await screen.findByRole('button', { name: 'Bogen entfernen' }));
    await user.selectOptions(screen.getByLabelText('Bereich'), 'gm');
    await user.click(saveButton());
    expect(await screen.findByText('Ungültiger Pfad (Der FATE-Bogen ist bereits entfernt.)')).toBeTruthy();
    expect(api.deleteSheet.mock.invocationCallOrder[0]).toBeLessThan(api.updateArticle.mock.invocationCallOrder[0]);
    // Zustand bleibt stimmig: kein zweites Löschen, Speichern geht erneut
    await user.click(saveButton());
    await waitFor(() => expect(location.hash).toBe('#/g/7/gm/a/1'));
    expect(api.deleteSheet).toHaveBeenCalledTimes(1);
  });

  it('behält den Bogen, wenn das Speichern des Artikels scheitert', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderEditing();
    api.updateArticle.mockRejectedValueOnce(new ApiFailure(400, 'Ungültiger Pfad'));
    await user.click(await screen.findByRole('button', { name: 'Bogen entfernen' }));
    await user.click(saveButton());
    expect(await screen.findByText('Ungültiger Pfad')).toBeTruthy();
    expect(api.deleteSheet).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Doch behalten' })).toBeTruthy();
  });

  it('legt einen anderswo gelöschten Bogen beim erneuten Speichern neu an', async () => {
    api.saveSheet.mockRejectedValue(new ApiFailure(404, 'Kein FATE-Bogen'));
    api.createSheet.mockResolvedValue(sheetOf());
    renderEditing();
    await user.type(await screen.findByLabelText('Name'), 'A');
    await user.click(saveButton());
    expect(await screen.findByText(/Der Bogen wurde inzwischen gelöscht\. Erneutes Speichern legt ihn/)).toBeTruthy();
    await user.click(saveButton());
    await waitFor(() => expect(api.createSheet).toHaveBeenCalledWith(7, 1, expect.objectContaining({ name: 'A' })));
  });

  it('bietet Neuladen an, wenn inzwischen jemand anderes einen Bogen angelegt hat', async () => {
    renderEditing({ hasSheet: false });
    api.createSheet.mockRejectedValue(new ApiFailure(409, 'Dieser Artikel hat bereits einen FATE-Bogen'));
    await user.click(await screen.findByRole('button', { name: 'FATE-Bogen hinzufügen' }));
    await screen.findByLabelText('Name');
    await user.click(saveButton());
    await user.click(await screen.findByRole('button', { name: 'Bogen neu laden' }));
    await waitFor(() => expect(api.sheet).toHaveBeenCalled());
    savesOk();
    await user.click(saveButton());
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledWith(7, 1, expect.objectContaining({ version: 1 })));
  });

  it('speichert nicht bei Enter in einem Bogenfeld und sperrt den Bogen während des Speicherns', async () => {
    let finish!: () => void;
    savesOk();
    renderEditing();
    api.updateArticle.mockImplementation((_g: number, id: number, input: object) => new Promise((resolve) => (finish = () => resolve(fullArticle({ id, ...input })))));
    await user.type(await screen.findByLabelText('Name'), 'A{Enter}');
    expect(api.updateArticle).not.toHaveBeenCalled();
    await user.click(saveButton());
    // Bogen und seine Knöpfe stehen in einem gesperrten fieldset
    expect(screen.getByLabelText('Name').closest('fieldset')!.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Bogen entfernen' }).closest('fieldset')!.disabled).toBe(true);
    finish();
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(1));
  });

  it('warnt beim Schließen des Tabs nur, wenn Text oder Bogen ungespeichert geändert sind', async () => {
    renderEditing();
    const name = await screen.findByLabelText('Name');
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await user.type(name, 'A');
    expect(unload()).toBe(true);
    await user.clear(name);
    expect(unload()).toBe(false);
    await user.type(screen.getByLabelText('Titel'), 'x');
    expect(unload()).toBe(true);
  });

  it('bietet keinen Bogen für Bereiche ohne Bögen an und verhindert das Speichern dorthin', async () => {
    api.folders.mockResolvedValue([]);
    api.article.mockResolvedValue(fullArticle({ section: 'gm' }));
    const gm = render(ArticleEdit, { group: gmGroup, section: 'gm', id: 1 });
    await screen.findByLabelText('Titel');
    expect(screen.queryByRole('button', { name: 'FATE-Bogen hinzufügen' })).toBeNull();
    gm.unmount();

    // eigener Artikel: nur dann darf er in den Bereich Spielleiter
    renderEditing({ authorId: GM.id });
    await screen.findByLabelText('Name');
    await user.selectOptions(screen.getByLabelText('Bereich'), 'gm');
    expect(screen.getByText(/zum Verschieben erst den Bogen entfernen/)).toBeTruthy();
    await user.click(saveButton());
    expect(await screen.findByText(/Bogen entfernen oder anderen Bereich wählen/)).toBeTruthy();
    expect(api.updateArticle).not.toHaveBeenCalled();
  });

  it('zeigt Ladefehler des Bogens, lässt den Text bearbeiten und sperrt nur das Speichern', async () => {
    renderEditing();
    api.sheet.mockRejectedValueOnce(new ApiFailure(500, 'Interner Fehler'));
    expect(await screen.findByText(/FATE-Bogen konnte nicht geladen werden: Interner Fehler/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'FATE-Bogen hinzufügen' })).toBeNull();
    await user.type(screen.getByLabelText('Titel'), 'x');
    await user.click(saveButton());
    expect(await screen.findByText(/bitte erst „Bogen neu laden“/)).toBeTruthy();
    expect(api.updateArticle).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Bogen neu laden' }));
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toBe('Wirtx');
  });

  it('legt den Bogen beim Anlegen eines Charakters gleich mit an', async () => {
    api.folders.mockResolvedValue([]);
    api.skills.mockResolvedValue(SKILLS);
    api.createArticle.mockResolvedValue(fullArticle({ id: 5, section: 'characters', title: 'Zoë' }));
    api.createSheet.mockResolvedValue(sheetOf());
    render(ArticleEdit, { group: gmGroup, section: 'characters' });
    await user.type(await screen.findByLabelText('Titel'), 'Zoë');
    await user.click(screen.getByRole('button', { name: 'FATE-Bogen hinzufügen' }));
    await user.type(await screen.findByLabelText(/Athletik/), '2');
    await user.click(saveButton());
    await waitFor(() => expect(location.hash).toBe('#/g/7/characters/a/5'));
    // Name leer gelassen: der Titel wird übernommen
    expect(api.createSheet).toHaveBeenCalledWith(7, 5, expect.objectContaining({ name: 'Zoë', skills: { 11: 2 } }));
  });

  it('landet auch dann beim neuen Artikel, wenn nur das Anlegen des Bogens scheitert', async () => {
    api.folders.mockResolvedValue([]);
    api.skills.mockResolvedValue(SKILLS);
    api.createArticle.mockResolvedValue(fullArticle({ id: 5, section: 'characters', title: 'Zoë' }));
    api.createSheet.mockRejectedValue(new ApiFailure(500, 'Interner Fehler'));
    render(ArticleEdit, { group: gmGroup, section: 'characters' });
    await user.type(await screen.findByLabelText('Titel'), 'Zoë');
    await user.click(screen.getByRole('button', { name: 'FATE-Bogen hinzufügen' }));
    await screen.findByLabelText('Name');
    await user.click(saveButton());
    await waitFor(() => expect(location.hash).toBe('#/g/7/characters/a/5'));
    expect(api.createArticle).toHaveBeenCalledTimes(1);
    expect(notice.text).toMatch(/^Artikel angelegt, der FATE-Bogen aber nicht \(Interner Fehler\)/);
  });

  it('zeigt einen Fehler, wenn die Fertigkeiten zum neuen Bogen nicht laden', async () => {
    api.folders.mockResolvedValue([]);
    api.skills.mockRejectedValue(new ApiFailure(500, 'Interner Fehler'));
    render(ArticleEdit, { group: gmGroup, section: 'notes' });
    await user.click(await screen.findByRole('button', { name: 'FATE-Bogen hinzufügen' }));
    expect(await screen.findByText('Interner Fehler')).toBeTruthy();
    expect(screen.queryByLabelText('Konzept')).toBeNull();
  });
});

describe('SkillListEditor', () => {
  it('fügt hinzu, sortiert, benennt um und entfernt', async () => {
    const skills = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
    const onchange = vi.fn();
    render(SkillListEditor, { skills, onchange });
    const values = () => screen.getAllByLabelText(/^Fertigkeit \d/).map((i) => (i as HTMLInputElement).value);

    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    expect(values()).toEqual(['A', 'B']);
    await user.type(screen.getByPlaceholderText('Neue Fertigkeit'), ' C {Enter}');
    expect(values()).toEqual(['A', 'B', 'C']);
    await user.click(screen.getByRole('button', { name: 'C nach oben' }));
    await user.click(screen.getByRole('button', { name: 'A nach unten' }));
    expect(values()).toEqual(['C', 'A', 'B']);
    await user.click(screen.getByRole('button', { name: 'A entfernen' }));
    expect(values()).toEqual(['C', 'B']);
    await user.type(screen.getByLabelText('Fertigkeit 1'), 'x');
    expect(values()).toEqual(['Cx', 'B']);
    expect((screen.getByRole('button', { name: 'Cx nach oben' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'B nach unten' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onchange).toHaveBeenCalledTimes(5);
  });

  it('zeigt einen Hinweis bei leerer Liste', () => {
    render(SkillListEditor, { skills: [] });
    expect(screen.getByText('Noch keine Fertigkeiten.')).toBeTruthy();
  });
});

describe('GmSkills', () => {
  it('speichert die geänderte Liste', async () => {
    api.skills.mockResolvedValue(SKILLS);
    api.saveSkills.mockResolvedValue([...SKILLS, { id: 13, name: 'Kochen' }]);
    render(GmSkills, { group: gmGroup });
    const save = (await screen.findByRole('button', { name: 'Speichern' })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByPlaceholderText('Neue Fertigkeit'), 'Kochen{Enter}');
    expect(screen.getByText('Ungespeicherte Änderungen')).toBeTruthy();
    await user.click(save);
    await waitFor(() => expect(api.saveSkills).toHaveBeenCalledWith(7, [...SKILLS, { name: 'Kochen' }], SKILLS));
    await waitFor(() => expect(save.disabled).toBe(true));
  });

  it('übernimmt eine Variante nach Rückfrage', async () => {
    api.skills.mockResolvedValue(SKILLS);
    api.presets.mockResolvedValue([presetFixture(), presetFixture({ id: 2, name: 'Turbo-Fate', description: '', skills: ['Flink'] })]);
    api.applyPreset.mockResolvedValue([{ id: 20, name: 'Flink' }]);
    render(GmSkills, { group: gmGroup });
    await user.selectOptions(await screen.findByLabelText('Variante'), 'Turbo-Fate (1)');
    expect(screen.getByText('Flink')).toBeTruthy();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(api.applyPreset).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(api.applyPreset).toHaveBeenCalledWith(7, 2, SKILLS));
    await waitFor(() => expect((screen.getByLabelText('Fertigkeit 1') as HTMLInputElement).value).toBe('Flink'));
  });

  it('warnt vor ungespeicherten Änderungen beim Laden einer Variante und zeigt Konflikte', async () => {
    api.skills.mockResolvedValue(SKILLS);
    api.applyPreset.mockRejectedValue(new ApiFailure(409, 'Die Fertigkeiten wurden inzwischen geändert'));
    render(GmSkills, { group: gmGroup });
    await user.type(await screen.findByPlaceholderText('Neue Fertigkeit'), 'Kochen{Enter}');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(confirm.mock.calls[0][0]).toMatch(/^Ungespeicherte Änderungen verwerfen/);
    expect(await screen.findByText('Die Fertigkeiten wurden inzwischen geändert')).toBeTruthy();
  });

  it('fragt auch nach, wenn die Liste ungespeichert geleert wurde', async () => {
    api.skills.mockResolvedValue([SKILLS[0]]);
    render(GmSkills, { group: gmGroup });
    await user.click(await screen.findByRole('button', { name: /entfernen/i }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(confirm).toHaveBeenCalled();
    expect(api.applyPreset).not.toHaveBeenCalled();
  });

  it('fragt bei leerer Liste nicht nach und kommt ohne Varianten zurecht', async () => {
    api.skills.mockResolvedValue([]);
    api.applyPreset.mockResolvedValue(SKILLS);
    const confirm = vi.spyOn(window, 'confirm');
    const first = render(GmSkills, { group: gmGroup });
    await user.click(await screen.findByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(api.applyPreset).toHaveBeenCalledWith(7, 1, []));
    expect(confirm).not.toHaveBeenCalled();
    first.unmount();

    api.presets.mockResolvedValue([]);
    render(GmSkills, { group: gmGroup });
    expect(await screen.findByText('Es sind keine Varianten hinterlegt.')).toBeTruthy();
  });

  it('zeigt Fehler', async () => {
    api.skills.mockRejectedValue(new ApiFailure(403, 'Nur für Spielleiter'));
    render(GmSkills, { group: gmGroup });
    expect(await screen.findByText('Nur für Spielleiter')).toBeTruthy();
  });

  it('ist als Tab im Spielleiter-Bereich erreichbar, für Spieler gesperrt', async () => {
    api.skills.mockResolvedValue(SKILLS);
    const gm = render(GroupLayout, { route: parseHash('#/g/7/skills') as never });
    expect(await screen.findByText('Fertigkeiten dieser Kampagne')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fertigkeiten' }).getAttribute('href')).toBe('#/g/7/skills');
    gm.unmount();
    signIn(PLAYER, [playerGroup]);
    render(GroupLayout, { route: parseHash('#/g/7/skills') as never });
    expect(screen.getByText('Dieser Bereich ist nur für Spielleiter.')).toBeTruthy();
  });
});

describe('Admin', () => {
  it('ist nur für Admins verlinkt und zugänglich', async () => {
    mockEmptyFolder(api);
    const normal = render(GroupSelect);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    normal.unmount();
    const denied = render(Admin);
    expect(screen.getByText('Dieser Bereich ist nur für Administratoren.')).toBeTruthy();
    expect(api.presets).toHaveBeenCalledTimes(1); // nur von GroupSelect
    denied.unmount();

    signIn(ADMIN, []);
    render(GroupSelect);
    expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('#/admin');
  });

  it('wird über die Route #/admin angezeigt', async () => {
    session.ready = false;
    api.me.mockResolvedValue({ user: ADMIN });
    api.groups.mockResolvedValue([]);
    router.route = parseHash('#/admin');
    render(App);
    expect(await screen.findByRole('heading', { name: /Fertigkeiten-Varianten/ })).toBeTruthy();
    expect(await screen.findByText('Athletik · Wille')).toBeTruthy();
  });

  it('legt Varianten an und bearbeitet sie', async () => {
    signIn(ADMIN, []);
    api.createPreset.mockResolvedValue(presetFixture({ id: 2 }));
    api.updatePreset.mockResolvedValue(presetFixture());
    render(Admin);
    await user.click(await screen.findByRole('button', { name: 'Neue Variante' }));
    await user.type(screen.getByLabelText('Name'), 'Mein Spiel');
    await user.type(screen.getByLabelText('Beschreibung / Quelle'), 'Hausregeln');
    await user.type(screen.getByPlaceholderText('Neue Fertigkeit'), 'Kochen{Enter}');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.createPreset).toHaveBeenCalledWith({ name: 'Mein Spiel', description: 'Hausregeln', skills: ['Kochen'] }));

    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Fate Core');
    await user.click(screen.getByRole('button', { name: 'Wille entfernen' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.updatePreset).toHaveBeenCalledWith(1, { name: 'Fate Core', description: 'Quelle', skills: ['Athletik'] }));
  });

  it('bricht ab, löscht nach Rückfrage und zeigt Fehler', async () => {
    signIn(ADMIN, []);
    api.deletePreset.mockRejectedValueOnce(new ApiFailure(404, 'Variante nicht gefunden')).mockResolvedValue({});
    render(Admin);
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(api.deletePreset).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(await screen.findByText('Variante nicht gefunden')).toBeTruthy();
    api.presets.mockResolvedValue([]);
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(await screen.findByText('Keine Varianten vorhanden.')).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(3);
  });
});

describe('Gruppe anlegen', () => {
  it('schlägt Fate Core vor und übergibt die gewählte Variante', async () => {
    signIn(GM, []);
    api.presets.mockResolvedValue([presetFixture({ id: 4, name: 'Turbo-Fate' }), presetFixture({ id: 9 })]);
    api.createGroup.mockResolvedValue(gmGroup);
    api.groups.mockResolvedValue([gmGroup]);
    render(GroupSelect);
    const select = (await screen.findByLabelText('Fertigkeiten')) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole<HTMLOptionElement>('option', { name: 'Fate Core (2)' }).selected).toBe(true));
    await user.type(screen.getByLabelText('Name der neuen Gruppe'), 'Runde');
    await user.click(screen.getByRole('button', { name: 'Gruppe anlegen' }));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith('Runde', 9));
  });

  it('funktioniert auch, wenn die Varianten nicht laden', async () => {
    signIn(GM, []);
    api.presets.mockRejectedValue(new Error('offline'));
    render(GroupSelect);
    expect(screen.getByLabelText('Name der neuen Gruppe')).toBeTruthy();
    expect(screen.queryByLabelText('Fertigkeiten')).toBeNull();
  });
});
