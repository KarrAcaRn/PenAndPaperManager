import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { Sheet, SheetData, Skill } from '@pnp/shared';
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
    render(CharacterSheet, { data, skills: SKILLS, onchange });
    await user.type(screen.getByLabelText('Konzept'), 'Schmugglerin');
    await user.click(screen.getByLabelText('Körperlicher Stress 2'));
    expect(onchange).toHaveBeenCalled();

    const athletik = screen.getByLabelText(/Athletik/);
    await user.type(athletik, '99');
    expect(onchange).toHaveBeenCalled();
    await user.clear(athletik);
    await user.type(athletik, 'x');
  });

  it('ist ohne Bearbeitungsrecht schreibgeschützt', () => {
    render(CharacterSheet, { data: sheetData(), skills: SKILLS, readonly: true });
    expect((screen.getByLabelText('Name') as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Stunts') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((screen.getByLabelText('Geistiger Stress 1') as HTMLInputElement).disabled).toBe(true);
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

describe('FATE-Bogen am Artikel', () => {
  it('lädt den Bogen und speichert Änderungen automatisch', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf({ name: 'Zoë' }));
    api.skills.mockResolvedValue(SKILLS);
    api.saveSheet.mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
    render(ArticleView, { group: gmGroup, id: 1 });

    const athletik = await screen.findByLabelText(/Athletik/);
    expect(screen.getByText('Änderungen werden automatisch gespeichert.')).toBeTruthy();
    await user.type(athletik, '3');
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(1));
    expect(api.saveSheet.mock.calls[0]).toEqual([7, 1, { version: 1, data: expect.objectContaining({ name: 'Zoë', skills: { 11: 3 } }) }]);
    expect(await screen.findByText(/^Gespeichert/)).toBeTruthy();
  });

  it('holt ein fehlgeschlagenes Speichern beim Verlassen nach, auch ohne weitere Eingabe', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue(SKILLS);
    api.saveSheet.mockRejectedValueOnce(new Error('Failed to fetch'));
    const view = render(ArticleView, { group: gmGroup, id: 1 });
    await user.type(await screen.findByLabelText('Name'), 'A');
    await screen.findByText(/Nicht gespeichert: Failed to fetch/);

    api.saveSheet.mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
    view.unmount();
    expect(api.saveSheet).toHaveBeenCalledTimes(2);
    expect(api.saveSheet.mock.calls[1][2]).toMatchObject({ version: 1, data: { name: 'A' } });
  });

  it('meldet einen Fehler beim Nachspeichern nach dem Verlassen als Hinweis', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true, title: 'Zoë' }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue(SKILLS);
    api.saveSheet.mockRejectedValue(new Error('Failed to fetch'));
    const view = render(ArticleView, { group: gmGroup, id: 1 });
    await user.type(await screen.findByLabelText('Name'), 'A');
    await screen.findByText(/Nicht gespeichert/);
    view.unmount();
    await waitFor(() => expect(notice.text).toMatch(/^FATE-Bogen „Zoë“: letzte Eingaben nicht gespeichert/));
  });

  it('speichert beim Schließen des Tabs sofort und fragt nach', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue(SKILLS);
    api.saveSheet.mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
    render(ArticleView, { group: gmGroup, id: 1 });
    const name = await screen.findByLabelText('Name');
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false); // nichts offen
    await user.type(name, 'A'); // Speichern erst nach Verzögerung geplant
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
    const name = await screen.findByLabelText('Name');
    await user.type(name, 'A');
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(1)); // läuft noch
    await user.type(name, 'B');
    await view.rerender({ route: parseHash('#/g/8/notes') as never });
    finishFirst(sheetOf({ name: 'A' }));
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(2));
    expect(api.saveSheet.mock.calls[1].slice(0, 2)).toEqual([7, 1]);
    expect(api.saveSheet.mock.calls[1][2]).toMatchObject({ data: { name: 'AB' } });
  });

  it('speichert beim Verlassen nicht erneut, wenn nichts aussteht', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue(SKILLS);
    api.saveSheet.mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
    const view = render(ArticleView, { group: gmGroup, id: 1 });
    await user.type(await screen.findByLabelText('Name'), 'A');
    await screen.findByText(/^Gespeichert/);
    view.unmount();
    expect(api.saveSheet).toHaveBeenCalledTimes(1);
  });

  it('zeigt Speicherfehler und speichert ausstehende Änderungen beim Verlassen', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue(SKILLS);
    api.saveSheet.mockRejectedValueOnce(new ApiFailure(403, 'Du darfst diesen Bogen nicht bearbeiten'));
    const view = render(ArticleView, { group: gmGroup, id: 1 });
    await user.type(await screen.findByLabelText('Name'), 'A');
    expect(await screen.findByText(/Nicht gespeichert: Du darfst/)).toBeTruthy();

    api.saveSheet.mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'AB' } });
    view.unmount();
    expect(api.saveSheet).toHaveBeenCalledTimes(2);
  });

  it('speichert nie zweimal gleichzeitig und reicht die neue Version weiter', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf({}, 5));
    api.skills.mockResolvedValue(SKILLS);
    let finishFirst!: () => void;
    api.saveSheet
      .mockImplementationOnce((_g: number, _a: number, sheet: Sheet) => new Promise((resolve) => (finishFirst = () => resolve({ ...sheet, version: 6 }))))
      .mockImplementation(async (_g: number, _a: number, sheet: Sheet) => ({ ...sheet, version: sheet.version + 1 }));
    render(ArticleView, { group: gmGroup, id: 1 });
    const name = await screen.findByLabelText('Name');
    await user.type(name, 'A');
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(1));
    await user.type(name, 'B');
    await new Promise((r) => setTimeout(r, 500));
    expect(api.saveSheet).toHaveBeenCalledTimes(1);

    finishFirst();
    await waitFor(() => expect(api.saveSheet).toHaveBeenCalledTimes(2));
    expect(api.saveSheet.mock.calls[0][2].version).toBe(5);
    expect(api.saveSheet.mock.calls[1][2]).toMatchObject({ version: 6, data: { name: 'AB' } });
  });

  it('stoppt bei einem Konflikt und lädt auf Wunsch neu', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValueOnce(sheetOf({ name: 'alt' })).mockResolvedValue(sheetOf({ name: 'vom Spieler' }, 3));
    api.skills.mockResolvedValue(SKILLS);
    api.saveSheet.mockRejectedValue(new ApiFailure(409, 'Der Bogen wurde inzwischen von jemand anderem geändert'));
    const view = render(ArticleView, { group: gmGroup, id: 1 });
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    await user.type(name, 'x');
    const reload = await screen.findByRole('button', { name: 'Neu laden' });
    expect(name.readOnly).toBe(true);
    fireEvent.input(name, { target: { value: 'trotzdem' } });
    await new Promise((r) => setTimeout(r, 500));
    expect(api.saveSheet).toHaveBeenCalledTimes(1);

    await user.click(reload);
    await waitFor(() => expect(name.value).toBe('vom Spieler'));
    expect(name.readOnly).toBe(false);
    expect(screen.queryByRole('button', { name: 'Neu laden' })).toBeNull();
    view.unmount();
    expect(api.saveSheet).toHaveBeenCalledTimes(1);
  });

  it('speichert nichts mehr, während oder nachdem der Bogen entfernt wird', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue(SKILLS);
    let finishDelete!: () => void;
    api.deleteSheet.mockImplementation(() => new Promise((resolve) => (finishDelete = () => resolve({}))));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(ArticleView, { group: gmGroup, id: 1 });
    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    await user.type(name, 'A');
    await user.click(screen.getByRole('button', { name: 'Bogen entfernen' }));
    expect(name.readOnly).toBe(true);
    fireEvent.input(name, { target: { value: 'zu spät' } });
    finishDelete();
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
    await new Promise((r) => setTimeout(r, 500));
    expect(api.saveSheet).not.toHaveBeenCalled();
  });

  it('gibt den Bogen wieder frei, wenn das Entfernen scheitert', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue(SKILLS);
    api.deleteSheet.mockRejectedValue(new ApiFailure(500, 'Interner Fehler'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(ArticleView, { group: gmGroup, id: 1 });
    await user.click(await screen.findByRole('button', { name: 'Bogen entfernen' }));
    expect(await screen.findByText(/Nicht gespeichert: Interner Fehler/)).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).readOnly).toBe(false);
  });

  it('ist für Leser schreibgeschützt und ohne Bearbeiten-Aktionen', async () => {
    signIn(PLAYER, [playerGroup]);
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true, canEdit: false }));
    // auch ein unvollständig gespeicherter Bogen wird vollständig dargestellt
    api.sheet.mockResolvedValue({ version: 1, data: { name: 'Zoë' } as never });
    api.skills.mockResolvedValue(SKILLS);
    render(ArticleView, { group: playerGroup, id: 1 });
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Bogen entfernen' })).toBeNull();
    expect(screen.getByRole('button', { name: /Drucken/ })).toBeTruthy();
  });

  it('druckt über den Browser', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'characters', hasSheet: true }));
    api.sheet.mockResolvedValue(sheetOf());
    api.skills.mockResolvedValue([]);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(ArticleView, { group: gmGroup, id: 1 });
    await user.click(await screen.findByRole('button', { name: /Drucken/ }));
    expect(print).toHaveBeenCalled();
  });

  it('lässt sich hinzufügen und nach Rückfrage entfernen', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'notes', title: 'Wirt' }));
    api.createSheet.mockResolvedValue(sheetOf());
    api.sheet.mockResolvedValue(sheetOf({ name: 'Wirt' }));
    api.skills.mockResolvedValue(SKILLS);
    api.deleteSheet.mockResolvedValue({});
    render(ArticleView, { group: gmGroup, id: 1 });

    const before = contentChanges.version;
    await user.click(await screen.findByRole('button', { name: 'FATE-Bogen hinzufügen' }));
    expect(api.createSheet).toHaveBeenCalledWith(7, 1, expect.objectContaining({ name: 'Wirt', refresh: '3' }));
    expect(contentChanges.version).toBe(before + 1); // Ordnerbaum zeigt das Bogen-Symbol
    const removeButton = await screen.findByRole('button', { name: 'Bogen entfernen' });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(removeButton);
    expect(api.deleteSheet).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    await user.click(removeButton);
    await waitFor(() => expect(screen.queryByLabelText('Konzept')).toBeNull());
    expect(screen.getByRole('button', { name: 'FATE-Bogen hinzufügen' })).toBeTruthy();
    expect(contentChanges.version).toBe(before + 2);
  });

  it('wird außerhalb von Charaktere und Notizen nicht angeboten', async () => {
    api.article.mockResolvedValue(fullArticle({ section: 'gm' }));
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

  it('kann beim Anlegen eines Charakters gleich mit angelegt werden', async () => {
    api.folders.mockResolvedValue([]);
    api.createArticle.mockResolvedValue(fullArticle({ id: 5, section: 'characters', title: 'Zoë' }));
    api.createSheet.mockResolvedValue(sheetOf());
    render(ArticleEdit, { group: gmGroup, section: 'characters' });
    await user.type(await screen.findByLabelText('Titel'), 'Zoë');
    await user.click(screen.getByLabelText(/Mit FATE-Bogen/));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(location.hash).toBe('#/g/7/characters/a/5'));
    expect(api.createSheet).toHaveBeenCalledWith(7, 5, expect.objectContaining({ name: 'Zoë' }));
  });

  it('landet auch dann beim neuen Artikel, wenn nur das Anlegen des Bogens scheitert', async () => {
    api.folders.mockResolvedValue([]);
    api.createArticle.mockResolvedValue(fullArticle({ id: 5, section: 'characters', title: 'Zoë' }));
    api.createSheet.mockRejectedValue(new ApiFailure(500, 'Interner Fehler'));
    render(ArticleEdit, { group: gmGroup, section: 'characters' });
    await user.type(await screen.findByLabelText('Titel'), 'Zoë');
    await user.click(screen.getByLabelText(/Mit FATE-Bogen/));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(location.hash).toBe('#/g/7/characters/a/5'));
    expect(api.createArticle).toHaveBeenCalledTimes(1);
    expect(notice.text).toMatch(/^Artikel angelegt, der FATE-Bogen aber nicht \(Interner Fehler\)/);
  });

  it('wird im Editor nur für neue Artikel in passenden Bereichen angeboten', async () => {
    api.folders.mockResolvedValue([]);
    const orte = render(ArticleEdit, { group: gmGroup, section: 'gm' });
    await screen.findByLabelText('Titel');
    expect(screen.queryByLabelText(/Mit FATE-Bogen/)).toBeNull();
    orte.unmount();
    api.article.mockResolvedValue(fullArticle({ section: 'characters' }));
    render(ArticleEdit, { group: gmGroup, section: 'characters', id: 1 });
    await screen.findByLabelText('Titel');
    expect(screen.queryByLabelText(/Mit FATE-Bogen/)).toBeNull();
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
