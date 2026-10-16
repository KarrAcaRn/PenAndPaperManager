import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { ApiFailure } from '../src/lib/api.ts';
import { parseHash, router } from '../src/lib/router.svelte.ts';
import { session } from '../src/lib/session.svelte.ts';
import App from '../src/App.svelte';
import Soundboard from '../src/routes/Soundboard.svelte';
import { PLAYER, mockApi, signIn } from './helpers.ts';
import { FakeXhr, builtinSound, connection } from './soundHelpers.ts';

let api: ReturnType<typeof mockApi>;
const user = userEvent.setup({ applyAccept: false });

const BUILTIN = [builtinSound('fanfare', 'Fanfare', 'Musik'), builtinSound('glocke', 'Glocke', 'Effekte'), builtinSound('trommel', 'Trommelwirbel', 'Effekte')];
const file = (name: string) => ({ id: `sb/${name}`, name, size: 100, mimeType: 'audio/mpeg', updatedAt: null });
const target = { method: 'PUT' as const, url: 'https://bucket.example/sb/neu.mp3?sig=up', headers: {}, fields: {}, fileId: 'sb/neu.mp3', expiresAt: '2099-01-01T00:00:00Z' };

let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  api = mockApi();
  api.builtinSounds.mockResolvedValue({ sounds: BUILTIN });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  FakeXhr.last = null;
  localStorage.clear();
  signIn(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tile = (name: string) => screen.getByRole('button', { name });

describe('Soundboard ohne Login', () => {
  it('ist über #/sounds erreichbar und zeigt die Standard-Sounds statt des Logins', async () => {
    expect(parseHash('#/sounds')).toEqual({ name: 'sounds' });
    location.hash = '#/sounds';
    router.route = { name: 'sounds' };
    session.ready = false;
    api.me.mockResolvedValue({ user: null });
    render(App);
    expect(await screen.findByRole('heading', { name: 'Soundboard' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Glocke' })).toBeTruthy();
    expect(location.hash).toBe('#/sounds');
    expect(api.storageConnections).not.toHaveBeenCalled();
  });

  it('spielt Standard-Sounds ab, gruppiert nach Kategorie, ohne Löschen und ohne Upload', async () => {
    render(Soundboard);
    await screen.findByRole('heading', { name: 'Musik' });
    expect(screen.getByRole('heading', { name: 'Effekte' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /löschen/ })).toBeNull();
    expect(screen.queryByText(/Dateien wählen/)).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Anmelden' }).length).toBeGreaterThan(0);

    await user.click(tile('Glocke'));
    await waitFor(() => expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true'));
    expect(play).toHaveBeenCalled();
    await user.click(tile('Glocke'));
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('false');
  });

  it('sucht nach Titel und filtert nach Kategorie', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.type(screen.getByRole('searchbox'), 'trom');
    expect(screen.queryByRole('button', { name: 'Glocke' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Trommelwirbel' })).toBeTruthy();
    await user.clear(screen.getByRole('searchbox'));
    const cats = screen.getByRole('group', { name: 'Kategorie' });
    await user.click(within(cats).getByRole('button', { name: 'Musik' }));
    expect(screen.getByRole('button', { name: 'Fanfare' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Glocke' })).toBeNull();
  });

  it('sucht auch in Kategorie und Schlagwörtern, im eigenen Bereich „Suche“ über alle Kategorien', async () => {
    api.builtinSounds.mockResolvedValue({ sounds: [...BUILTIN.slice(0, 2), { ...BUILTIN[2], tags: ['Spannung'] }] });
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    const cats = screen.getByRole('group', { name: 'Kategorie' });
    await user.click(within(cats).getByRole('button', { name: 'Musik' }));
    await user.type(screen.getByRole('searchbox'), 'spann');
    expect(screen.getByRole('button', { name: 'Trommelwirbel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fanfare' })).toBeNull();
    expect(within(cats).getByRole('button', { name: 'Suche' }).getAttribute('aria-pressed')).toBe('true');
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'effekte');
    expect(screen.getByRole('button', { name: 'Glocke' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fanfare' })).toBeNull();
    // Suche leeren: zurück zur gewählten Kategorie
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getByRole('button', { name: 'Fanfare' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Glocke' })).toBeNull();
  });

  it('bedient sich per Tastatur: Tasten je Kachel, Pfeile für Kategorie und Musik-Lautstärke, Alt für die Suche', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    // Reihenfolge der Anzeige: Musik (Fanfare), Effekte (Glocke, Trommelwirbel)
    expect(tile('Fanfare').getAttribute('aria-keyshortcuts')).toBe('0');
    expect(tile('Glocke').getAttribute('aria-keyshortcuts')).toBe('1');
    expect(tile('Trommelwirbel').getAttribute('aria-keyshortcuts')).toBe('2');

    await user.keyboard('1');
    await waitFor(() => expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true'));
    await user.keyboard('1');
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('false');

    // Pfeil rechts: Alle → Musik → Effekte; die Tasten zählen je Bereich neu
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.queryByRole('button', { name: 'Fanfare' })).toBeNull();
    expect(tile('Glocke').getAttribute('aria-keyshortcuts')).toBe('0');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Fanfare' })).toBeTruthy();
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('button', { name: 'Fanfare' })).toBeNull();

    const volume = () => JSON.parse(localStorage.getItem('pnp.soundboard')!).musicVolume as number;
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(volume()).toBeCloseTo(0.72);
    await user.keyboard('{ArrowDown}');
    expect(volume()).toBeCloseTo(0.71);
    expect(Number((screen.getByRole('slider', { name: 'Musik' }) as HTMLInputElement).value)).toBeCloseTo(0.71);

    await user.keyboard('{Alt}');
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    // beim Tippen im Suchfeld sind die Tasten Text
    const before = play.mock.calls.length;
    await user.keyboard('0');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('0');
    expect(play.mock.calls.length).toBe(before);
  });

  it('schaltet die Tasten bei offenem Dialog ab', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    try {
      await user.keyboard('1');
      expect(tile('Glocke').getAttribute('aria-pressed')).toBe('false');
    } finally {
      dialog.remove();
    }
  });

  it('merkt sich Lautstärke und Endlosschleife je Sound und wendet sie auch während der Wiedergabe an', async () => {
    const { unmount } = render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(tile('Glocke'));
    await waitFor(() => expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true'));
    const audio = play.mock.contexts.at(-1) as HTMLAudioElement;
    expect(audio.loop).toBe(false);

    const loop = screen.getByRole('button', { name: 'Endlosschleife für „Glocke“' });
    await user.click(loop);
    expect(loop.getAttribute('aria-pressed')).toBe('true');
    expect(audio.loop).toBe(true);

    const own = screen.getByLabelText('Lautstärke von „Glocke“') as HTMLInputElement;
    await fireEvent.input(own, { target: { value: '0.5' } });
    expect(audio.volume).toBeCloseTo(0.4); // 0,8 gesamt × 0,5

    unmount();
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    expect(screen.getByRole('button', { name: 'Endlosschleife für „Glocke“' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Lautstärke von „Glocke“') as HTMLInputElement).value).toBe('0.5');
    expect(screen.getByRole('button', { name: 'Endlosschleife für „Fanfare“' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('meldet, wenn die Standard-Sounds nicht laden', async () => {
    api.builtinSounds.mockRejectedValue(new Error('Server weg'));
    render(Soundboard);
    expect(await screen.findByText(/Standard-Sounds konnten nicht geladen werden: Server weg/)).toBeTruthy();
  });
});

describe('Soundboard: Musik und Effekte', () => {
  const nowPlaying = () => screen.getByRole('status');
  const audioFor = (name: string) => [...(play.mock.contexts as HTMLAudioElement[])].reverse().find((a) => a.src.endsWith(`/${name}.wav`))!;

  beforeEach(() => {
    api.builtinSounds.mockResolvedValue({ sounds: [...BUILTIN, builtinSound('hymne', 'Hymne', 'Musik')] });
  });

  it('spielt Musik und Effekte gleichzeitig, ein zweiter Musiktitel ersetzt den ersten', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    expect(nowPlaying().textContent).toMatch(/Keine Musik/);

    await user.click(tile('Fanfare'));
    await user.click(tile('Glocke'));
    await waitFor(() => expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true'));
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('true');
    expect(nowPlaying().textContent).toMatch(/Läuft: Fanfare/);

    await user.click(tile('Hymne'));
    await waitFor(() => expect(nowPlaying().textContent).toMatch(/Läuft: Hymne/));
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('false');
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true');
    expect(audioFor('hymne').loop).toBe(true);
  });

  it('stoppt Musik, Effekte oder alles getrennt', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    const stopMusic = screen.getByRole('button', { name: 'Musik stoppen' }) as HTMLButtonElement;
    const stopSfx = screen.getByRole('button', { name: 'Effekte stoppen' }) as HTMLButtonElement;
    expect(stopMusic.disabled && stopSfx.disabled).toBe(true);

    await user.click(tile('Fanfare'));
    await user.click(tile('Glocke'));
    await user.click(stopSfx);
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('false');
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('true');
    await user.click(stopMusic);
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('false');
    expect(nowPlaying().textContent).toMatch(/Keine Musik/);

    await user.click(tile('Fanfare'));
    await user.click(tile('Glocke'));
    await user.click(screen.getByRole('button', { name: 'Alle stoppen' }));
    expect(document.querySelectorAll('button.play[aria-pressed="true"]')).toHaveLength(0);
  });

  it('regelt die Kanäle unabhängig und merkt sich Lautstärken und Schleife', async () => {
    const { unmount } = render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(tile('Fanfare'));
    await user.click(tile('Glocke'));
    const slider = (name: string) => screen.getByRole('slider', { name }) as HTMLInputElement;
    const set = (name: string, value: string) => {
      slider(name).value = value;
      slider(name).dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('Musik', '0.5');
    expect(audioFor('fanfare').volume).toBeCloseTo(0.4);
    expect(audioFor('glocke').volume).toBeCloseTo(0.8);
    set('Effekte', '0.25');
    expect(audioFor('glocke').volume).toBeCloseTo(0.2);
    expect(audioFor('fanfare').volume).toBeCloseTo(0.4);
    set('Gesamt', '0.5');
    expect(audioFor('fanfare').volume).toBeCloseTo(0.25);
    await user.click(screen.getByRole('checkbox', { name: 'Musik wiederholen' }));
    expect(audioFor('fanfare').loop).toBe(false);

    unmount();
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    expect([slider('Gesamt').value, slider('Musik').value, slider('Effekte').value]).toEqual(['0.5', '0.5', '0.25']);
    expect((screen.getByRole('checkbox', { name: 'Musik wiederholen' }) as HTMLInputElement).checked).toBe(false);
  });

  it('zeigt Musik und Effekte getrennt und lässt den Typ eines Sounds ändern – auch nach dem Neuladen', async () => {
    const { unmount } = render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    expect((screen.getByRole('combobox', { name: 'Typ von „Glocke“' }) as HTMLSelectElement).value).toBe('sfx');
    expect((screen.getByRole('combobox', { name: 'Typ von „Fanfare“' }) as HTMLSelectElement).value).toBe('music');

    const viewButton = (name: string) => within(screen.getByRole('group', { name: 'Art der Sounds' })).getByRole('button', { name });
    await user.click(viewButton('Hintergrundmusik'));
    expect(viewButton('Hintergrundmusik').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Glocke' })).toBeNull();
    expect(tile('Fanfare')).toBeTruthy();
    await user.click(viewButton('Effekte'));
    expect(screen.queryByRole('button', { name: 'Fanfare' })).toBeNull();

    // Glocke wird Musik: verschwindet aus den Effekten und ersetzt beim Abspielen die laufende Musik
    await user.selectOptions(screen.getByRole('combobox', { name: 'Typ von „Glocke“' }), 'music');
    expect(screen.queryByRole('button', { name: 'Glocke' })).toBeNull();
    await user.click(viewButton('Alle'));
    await user.click(tile('Fanfare'));
    await user.click(tile('Glocke'));
    await waitFor(() => expect(nowPlaying().textContent).toMatch(/Läuft: Glocke/));
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('false');

    // ein laufender Sound, dessen Typ sich ändert, wird gestoppt (er gehört jetzt zum anderen Kanal)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Typ von „Glocke“' }), 'sfx');
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('false');
    expect(nowPlaying().textContent).toMatch(/Keine Musik/);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Typ von „Glocke“' }), 'music');

    unmount();
    render(Soundboard);
    expect(((await screen.findByRole('combobox', { name: 'Typ von „Glocke“' })) as HTMLSelectElement).value).toBe('music');
  });
});

describe('Soundboard: Playlisten', () => {
  const audioFor = (name: string) => [...(play.mock.contexts as HTMLAudioElement[])].reverse().find((a) => a.src.endsWith(`/${name}.wav`))!;
  const playlistStatus = () => within(screen.getByRole('region', { name: 'Playlisten' })).getByRole('status');
  const tracks = () => within(screen.getByRole('list', { name: /^Titel von/ })).getAllByRole('listitem');
  const control = (name: string) => within(screen.getByRole('group', { name: 'Steuerung der Playlist' })).getByRole('button', { name });
  /** der laufende Titel ist von selbst zu Ende */
  const finish = (name: string) => audioFor(name).onended!(new Event('ended'));

  beforeEach(() => {
    api.builtinSounds.mockResolvedValue({ sounds: [...BUILTIN, builtinSound('hymne', 'Hymne', 'Musik')] });
  });

  it('füllt per „+“ eine neue Playlist, spielt den ersten Titel sofort und schaltet am Ende weiter', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    expect(screen.getByText(/Noch keine Playlist/)).toBeTruthy();
    // nur Musik-Kacheln haben „+“
    expect(screen.queryByRole('button', { name: /„Glocke“ zu.*Playlist/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: '„Fanfare“ zu einer neuen Playlist hinzufügen' }));
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare · Titel 1 von 1 aus „Playlist 1“/));
    expect(audioFor('fanfare').loop).toBe(false);
    await user.click(screen.getByRole('button', { name: '„Hymne“ zu „Playlist 1“ hinzufügen' }));
    expect(tracks().map((li) => li.textContent)).toEqual([expect.stringContaining('Fanfare'), expect.stringContaining('Hymne')]);
    expect(tracks()[0].getAttribute('aria-current')).toBe('true');
    expect(tile('Hymne').closest('li')!.classList.contains('in-playlist')).toBe(true);

    // Effekt darüber unterbricht die Playlist nicht
    await user.click(tile('Glocke'));
    await waitFor(() => expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true'));
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('true');

    finish('fanfare');
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Hymne · Titel 2 von 2/));
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true');
    finish('hymne');
    // Wiederholen „alle“ ist Vorgabe (wie in der Referenz)
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare · Titel 1 von 2/));
  });

  it('stellt die Playlisten wie in der Referenz neben die Bibliothek (eigene Spalte)', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    const side = screen.getByRole('complementary');
    expect(within(side).getByRole('region', { name: 'Playlisten' })).toBeTruthy();
    expect(side.contains(tile('Glocke'))).toBe(false);
    expect(side.nextElementSibling!.contains(tile('Glocke'))).toBe(true);
  });

  it('bedient Pause, Weiter, Zurück, Zufall, Wiederholen und Reihenfolge und merkt sich alles über das Neuladen', async () => {
    const { unmount } = render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(screen.getByRole('button', { name: 'Neue Playlist' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Taverne{Enter}');
    await user.click(screen.getByRole('button', { name: '„Fanfare“ zu „Taverne“ hinzufügen' }));
    await user.click(screen.getByRole('button', { name: '„Hymne“ zu „Taverne“ hinzufügen' }));
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare/));

    await user.click(control('Anhalten'));
    expect(playlistStatus().textContent).toMatch(/Angehalten: Fanfare/);
    await user.click(control('Abspielen'));
    expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare/);
    await user.click(control('Nächster Titel'));
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Hymne/));
    await user.click(control('Vorheriger Titel'));
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare/));

    // Hymne nach oben: der laufende Titel bleibt, steht jetzt an Stelle 2
    await user.click(screen.getByRole('button', { name: '„Hymne“ nach oben' }));
    expect(tracks()[0].textContent).toMatch(/Hymne/);
    expect(playlistStatus().textContent).toMatch(/Fanfare · Titel 2 von 2/);

    await user.click(control('Zufall'));
    expect(control('Zufall').getAttribute('aria-pressed')).toBe('true');
    await user.click(control('Wiederholen: alle'));
    expect(control('Wiederholen: einen Titel')).toBeTruthy();
    finish('fanfare');
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare · Titel 2 von 2/));
    await user.click(control('Wiederholen: einen Titel'));
    expect(control('Wiederholen: aus')).toBeTruthy();

    unmount();
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    expect((screen.getByRole('combobox', { name: 'Playlist' }) as HTMLSelectElement).selectedOptions[0].textContent).toBe('Taverne (2)');
    expect(tracks().map((li) => li.textContent)).toEqual([expect.stringContaining('Hymne'), expect.stringContaining('Fanfare')]);
    expect(control('Zufall').getAttribute('aria-pressed')).toBe('true');
    expect(control('Wiederholen: aus')).toBeTruthy();
    // ohne Zufall der Reihe nach von vorn
    await user.click(control('Zufall'));
    await user.click(control('Abspielen'));
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Hymne · Titel 1 von 2 aus „Taverne“/));
  });

  it('Doppelklick springt zu einem Titel, Entfernen spielt den nächsten, Musik per Kachel übernimmt', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(screen.getByRole('button', { name: 'Neue Playlist' }));
    for (const t of ['Fanfare', 'Hymne', 'Fanfare']) await user.click(screen.getByRole('button', { name: `„${t}“ zu „Playlist 1“ hinzufügen` }));
    await user.dblClick(tracks()[1]);
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Hymne · Titel 2 von 3/));
    await user.click(screen.getAllByRole('button', { name: '„Hymne“ aus der Playlist entfernen' })[0]);
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare · Titel 2 von 2/));

    // Musik per Kachel ersetzt den Titel; dessen Ende schaltet nicht weiter
    await user.click(tile('Hymne'));
    await waitFor(() => expect(tile('Hymne').getAttribute('aria-pressed')).toBe('true'));
    expect(playlistStatus().textContent).toMatch(/Gestoppt: Fanfare/);
    finish('hymne');
    await waitFor(() => expect(tile('Hymne').getAttribute('aria-pressed')).toBe('false'));
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('false');

    // „Musik stoppen“ beendet auch die Playlist
    await user.click(control('Abspielen'));
    await waitFor(() => expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('true'));
    await user.click(screen.getByRole('button', { name: 'Musik stoppen' }));
    expect(within(screen.getByRole('region', { name: 'Playlisten' })).queryByRole('status')).toBeNull();
  });

  it('Doppelklick auf die Knöpfe einer Zeile springt nicht; Typwechsel des laufenden Titels hält die Playlist nicht an', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(screen.getByRole('button', { name: 'Neue Playlist' }));
    for (const t of ['Fanfare', 'Hymne']) await user.click(screen.getByRole('button', { name: `„${t}“ zu „Playlist 1“ hinzufügen` }));
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare · Titel 1 von 2/));
    await user.dblClick(screen.getByRole('button', { name: '„Hymne“ nach oben' }));
    expect(tracks()[0].textContent).toMatch(/Hymne/);
    expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare · Titel 2 von 2/);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Typ von „Fanfare“' }), 'sfx');
    expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare/);
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('true');
    // der Titel bleibt in der Playlist, das Ende schaltet weiter
    finish('fanfare');
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Hymne · Titel 1 von 2/));
  });

  it('zeigt den Fortschritt und spult beim Loslassen des Reglers', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(screen.getByRole('button', { name: '„Fanfare“ zu einer neuen Playlist hinzufügen' }));
    await waitFor(() => expect(playlistStatus().textContent).toMatch(/Läuft: Fanfare/));
    const audio = audioFor('fanfare');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 125 });
    audio.currentTime = 61;
    const slider = (await screen.findByRole('slider', { name: 'Position im Titel' })) as HTMLInputElement;
    await waitFor(() => expect(slider.getAttribute('aria-valuetext')).toBe('1:01 von 2:05'));
    slider.value = '90';
    await fireEvent.input(slider);
    await fireEvent.change(slider);
    expect(audio.currentTime).toBe(90);
  });

  it('sortiert Titel per Drag & Drop', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(screen.getByRole('button', { name: 'Neue Playlist' }));
    for (const t of ['Fanfare', 'Hymne']) await user.click(screen.getByRole('button', { name: `„${t}“ zu „Playlist 1“ hinzufügen` }));
    const data: Record<string, string> = {};
    const dataTransfer = { types: ['application/x-pnp-playlist-entry'], setData: (k: string, v: string) => (data[k] = v), effectAllowed: '', dropEffect: '' };
    await fireEvent.dragStart(tracks()[1], { dataTransfer });
    expect(Object.keys(data)).toEqual(['application/x-pnp-playlist-entry']);
    expect(await fireEvent.dragOver(tracks()[0], { dataTransfer })).toBe(false);
    await fireEvent.drop(tracks()[0], { dataTransfer });
    expect(tracks().map((li) => li.textContent)).toEqual([expect.stringContaining('Hymne'), expect.stringContaining('Fanfare')]);
    // ohne laufendes Ziehen einer Zeile nimmt die Liste nichts an
    expect(await fireEvent.dragOver(tracks()[0], { dataTransfer: { types: ['Files'] } })).toBe(true);
  });

  it('löscht Playlisten erst nach Bestätigung, die Sounds bleiben', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(screen.getByRole('button', { name: '„Fanfare“ zu einer neuen Playlist hinzufügen' }));
    await user.click(screen.getByRole('button', { name: 'Playlist löschen' }));
    expect(tracks()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Playlist löschen' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Noch keine Playlist/)).toBeTruthy();
    expect(tile('Fanfare').getAttribute('aria-pressed')).toBe('false');
    expect(tile('Fanfare').closest('li')!.classList.contains('in-playlist')).toBe(false);
  });
});

describe('Soundboard: Effekt-Liste', () => {
  const panel = () => screen.getByRole('region', { name: 'Effekt-Liste' });
  const entries = () => within(screen.getByRole('list', { name: 'Effekte der Effekt-Liste' })).getAllByRole('listitem');
  /** Audio-Elemente eines Sounds in Startreihenfolge (auch gestoppte, deren src schon entfernt ist) */
  let started: { audio: HTMLAudioElement; src: string }[] = [];
  const audiosFor = (name: string) => started.filter((s) => s.src.endsWith(`/${name}.wav`)).map((s) => s.audio);
  const stopped = (audio: HTMLAudioElement) => audio.getAttribute('src') === null;

  beforeEach(() => {
    started = [];
    play.mockImplementation(function (this: HTMLAudioElement) {
      started.push({ audio: this, src: this.src });
      return Promise.resolve();
    });
  });

  it('fügt per „+“ hinzu: startet sofort bei Lautstärke 0 in Schleife auf dem Effektkanal, der Regler blendet ein', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    expect(within(panel()).getByText(/Noch keine Effekte/)).toBeTruthy();
    // nur Effekt-Kacheln haben „+“ für die Effekt-Liste
    expect(screen.queryByRole('button', { name: '„Fanfare“ zur Effekt-Liste hinzufügen' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '„Glocke“ zur Effekt-Liste hinzufügen' }));
    expect(entries()).toHaveLength(1);
    const toggle = within(panel()).getByRole('button', { name: '„Glocke“ in der Effekt-Liste stoppen' });
    await waitFor(() => expect(toggle.textContent).toBe('■'));
    const audio = audiosFor('glocke').at(-1)!;
    expect(audio.volume).toBe(0);
    expect(audio.loop).toBe(true);
    // die Kachel selbst bleibt unabhängig (Klick spielt sofort, wie bisher)
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('false');
    expect(tile('Glocke').closest('li')!.classList.contains('in-playlist')).toBe(true);

    const slider = within(panel()).getByLabelText('Lautstärke von „Glocke“ in der Effekt-Liste') as HTMLInputElement;
    await fireEvent.input(slider, { target: { value: '0.5' } });
    expect(audio.volume).toBeCloseTo(0.4); // 0,8 gesamt × 1 Effekte × 0,5
    // Kanal-Lautstärke gilt
    await fireEvent.input(screen.getByLabelText('Effekte'), { target: { value: '0.5' } });
    expect(audio.volume).toBeCloseTo(0.2);
    // die eigene Lautstärke der Kachel spielt für den Eintrag keine Rolle
    await fireEvent.input(screen.getByLabelText('Lautstärke von „Glocke“'), { target: { value: '0.1' } });
    expect(audio.volume).toBeCloseTo(0.2);

    await user.click(within(panel()).getByRole('button', { name: 'Endlosschleife für „Glocke“ in der Effekt-Liste' }));
    expect(audio.loop).toBe(false);

    // Stopp und Start je Eintrag
    await user.click(toggle);
    expect(stopped(audio)).toBe(true);
    await user.click(within(panel()).getByRole('button', { name: '„Glocke“ in der Effekt-Liste abspielen' }));
    await waitFor(() => expect(audiosFor('glocke')).toHaveLength(2));
    expect(audiosFor('glocke')[1].volume).toBeCloseTo(0.2);

    // „Effekte stoppen“ hält auch die Effekt-Liste an
    await user.click(screen.getByRole('button', { name: 'Effekte stoppen' }));
    expect(within(panel()).getByRole('button', { name: '„Glocke“ in der Effekt-Liste abspielen' })).toBeTruthy();
  });

  it('läuft neben der Kachel desselben Sounds und mehrfach; Entfernen stoppt nur den Eintrag', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    const add = () => user.click(screen.getByRole('button', { name: '„Glocke“ zur Effekt-Liste hinzufügen' }));
    await add();
    await add();
    await user.click(tile('Glocke'));
    await waitFor(() => expect(audiosFor('glocke')).toHaveLength(3));
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true');
    const [first, second, byTile] = audiosFor('glocke');

    await user.click(within(panel()).getAllByRole('button', { name: '„Glocke“ aus der Effekt-Liste entfernen' })[0]);
    expect(entries()).toHaveLength(1);
    expect(stopped(first)).toBe(true);
    expect(stopped(second)).toBe(false);
    expect(stopped(byTile)).toBe(false);
    expect(tile('Glocke').getAttribute('aria-pressed')).toBe('true');
    await user.click(within(panel()).getByRole('button', { name: '„Glocke“ aus der Effekt-Liste entfernen' }));
    expect(within(panel()).getByText(/Noch keine Effekte/)).toBeTruthy();
    expect(stopped(second)).toBe(true);
    expect(tile('Glocke').closest('li')!.classList.contains('in-playlist')).toBe(false);
  });

  it('merkt sich Einträge, Regler und Schleife über das Neuladen; danach läuft nichts von selbst', async () => {
    const { unmount } = render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    await user.click(screen.getByRole('button', { name: '„Trommelwirbel“ zur Effekt-Liste hinzufügen' }));
    await fireEvent.input(within(panel()).getByLabelText('Lautstärke von „Trommelwirbel“ in der Effekt-Liste'), { target: { value: '0.3' } });
    await user.click(within(panel()).getByRole('button', { name: 'Endlosschleife für „Trommelwirbel“ in der Effekt-Liste' }));
    unmount();
    expect(JSON.parse(localStorage.getItem('pnp.soundboard.effects')!).entries).toEqual([
      expect.objectContaining({ sound: 'builtin:trommel', title: 'Trommelwirbel', volume: 0.3, loop: false }),
    ]);

    const before = play.mock.calls.length;
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    expect(entries()).toHaveLength(1);
    expect((within(panel()).getByLabelText('Lautstärke von „Trommelwirbel“ in der Effekt-Liste') as HTMLInputElement).value).toBe('0.3');
    expect(within(panel()).getByRole('button', { name: 'Endlosschleife für „Trommelwirbel“ in der Effekt-Liste' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(panel()).getByRole('button', { name: '„Trommelwirbel“ in der Effekt-Liste abspielen' })).toBeTruthy();
    expect(play.mock.calls.length).toBe(before);
  });

  it('sortiert per Drag & Drop nur am Griff und per Pfeiltaste auf dem Griff', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    for (const t of ['Glocke', 'Trommelwirbel']) await user.click(screen.getByRole('button', { name: `„${t}“ zur Effekt-Liste hinzufügen` }));
    const names = () => entries().map((li) => li.querySelector('.name')!.textContent);
    expect(names()).toEqual(['Glocke', 'Trommelwirbel']);
    const data: Record<string, string> = {};
    const dataTransfer = { types: ['application/x-pnp-effect-entry'], setData: (k: string, v: string) => (data[k] = v), effectAllowed: '', dropEffect: '' };

    // Ziehen an der Zeile (z.B. am Regler) verschiebt nichts
    expect(entries()[1].getAttribute('draggable')).toBe('false');
    await fireEvent.dragStart(entries()[1], { dataTransfer });
    await fireEvent.dragOver(entries()[0], { dataTransfer });
    await fireEvent.drop(entries()[0], { dataTransfer });
    expect(names()).toEqual(['Glocke', 'Trommelwirbel']);

    // Griff drücken macht die Zeile ziehbar, Loslassen ohne Ziehen wieder nicht
    const handle = within(panel()).getByRole('button', { name: '„Trommelwirbel“ verschieben' });
    await fireEvent.mouseDown(handle);
    expect(entries()[1].getAttribute('draggable')).toBe('true');
    await fireEvent.mouseUp(window);
    expect(entries()[1].getAttribute('draggable')).toBe('false');

    await fireEvent.mouseDown(handle);
    await fireEvent.dragStart(entries()[1], { dataTransfer });
    expect(Object.keys(data)).toEqual(['application/x-pnp-effect-entry']);
    expect(await fireEvent.dragOver(entries()[0], { dataTransfer })).toBe(false);
    await fireEvent.drop(entries()[0], { dataTransfer });
    expect(names()).toEqual(['Trommelwirbel', 'Glocke']);
    expect(entries()[0].getAttribute('draggable')).toBe('false');
    expect(JSON.parse(localStorage.getItem('pnp.soundboard.effects')!).entries.map((e: { sound: string }) => e.sound)).toEqual(['builtin:trommel', 'builtin:glocke']);

    // Tastatur: Pfeil runter auf dem Griff, ohne die Musik-Lautstärke zu ändern; der Griff behält den Fokus
    const music = (screen.getByLabelText('Musik') as HTMLInputElement).value;
    within(panel()).getByRole('button', { name: '„Trommelwirbel“ verschieben' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(names()).toEqual(['Glocke', 'Trommelwirbel']);
    expect(document.activeElement).toBe(within(panel()).getByRole('button', { name: '„Trommelwirbel“ verschieben' }));
    await user.keyboard('{ArrowDown}');
    expect(names()).toEqual(['Glocke', 'Trommelwirbel']);
    await user.keyboard('{ArrowUp}');
    expect(names()).toEqual(['Trommelwirbel', 'Glocke']);
    expect((screen.getByLabelText('Musik') as HTMLInputElement).value).toBe(music);
  });

  it('verschiebt beim Ziehen den gezogenen Eintrag, auch wenn sich die Liste währenddessen ändert', async () => {
    render(Soundboard);
    await screen.findByRole('button', { name: 'Glocke' });
    for (const t of ['Glocke', 'Trommelwirbel', 'Glocke']) await user.click(screen.getByRole('button', { name: `„${t}“ zur Effekt-Liste hinzufügen` }));
    const names = () => entries().map((li) => li.querySelector('.name')!.textContent);
    const dataTransfer = { types: ['application/x-pnp-effect-entry'], setData: () => {}, effectAllowed: '', dropEffect: '' };
    const dragged = entries()[1];
    await fireEvent.mouseDown(within(dragged).getByRole('button', { name: '„Trommelwirbel“ verschieben' }));
    await fireEvent.dragStart(dragged, { dataTransfer });
    // währenddessen verschwindet der erste Eintrag
    await fireEvent.click(within(entries()[0]).getByRole('button', { name: '„Glocke“ aus der Effekt-Liste entfernen' }));
    expect(names()).toEqual(['Trommelwirbel', 'Glocke']);
    await fireEvent.drop(entries()[1], { dataTransfer });
    expect(names()).toEqual(['Glocke', 'Trommelwirbel']);
  });
});

describe('Soundboard mit Login', () => {
  beforeEach(() => signIn(PLAYER));

  it('verweist ohne verbundenen Speicher auf die Kontoeinstellungen statt einen Upload anzubieten', async () => {
    api.storageConnections.mockResolvedValue([]);
    render(Soundboard);
    const link = await screen.findByRole('link', { name: 'Kontoeinstellungen' });
    expect(link.getAttribute('href')).toBe('#/settings');
    expect(screen.queryByText(/Dateien wählen/)).toBeNull();
    expect(await screen.findByRole('button', { name: 'Glocke' })).toBeTruthy();
  });

  it('zeigt die Dateien je Speicher und holt die Playback-URL erst beim Abspielen', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [file('Drachenkampf.mp3')], nextCursor: null });
    api.playbackUrl.mockResolvedValue({ url: 'https://bucket.example/sb/Drachenkampf.mp3?sig=get', expiresAt: '2099-01-01T00:00:00Z' });
    render(Soundboard);
    const section = await screen.findByRole('region', { name: 'Mein Bucket' });
    await within(section).findByRole('button', { name: 'Drachenkampf' });
    expect(api.playbackUrl).not.toHaveBeenCalled();

    await user.click(within(section).getByRole('button', { name: 'Drachenkampf' }));
    await waitFor(() => expect(api.playbackUrl).toHaveBeenCalledWith(3, 'sb/Drachenkampf.mp3'));
    const audioSrc = (play.mock.contexts.at(-1) as HTMLAudioElement).src;
    expect(audioSrc).toBe('https://bucket.example/sb/Drachenkampf.mp3?sig=get');

    // Filter nach Quelle: nur der Speicher
    await user.selectOptions(screen.getByLabelText('Quelle'), 'Mein Bucket');
    expect(screen.queryByRole('heading', { name: 'Standard' })).toBeNull();
  });

  it('zeigt Unterordner im Speicher als Kategorien neben denen der Standard-Sounds', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [file('Lose.mp3'), file('Wetter/Regen.mp3'), file('Wetter/Sturm.mp3')], nextCursor: null });
    render(Soundboard);
    const section = await screen.findByRole('region', { name: 'Mein Bucket' });
    await within(section).findByRole('button', { name: 'Regen' });
    expect(within(section).getByRole('heading', { name: 'Wetter' })).toBeTruthy();
    const cats = screen.getByRole('group', { name: 'Kategorie' });
    await user.click(within(cats).getByRole('button', { name: 'Wetter' }));
    expect(within(section).getByRole('button', { name: 'Sturm' })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: 'Lose' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Glocke' })).toBeNull();
    // Tasten zählen über alle sichtbaren Kacheln
    expect(within(section).getByRole('button', { name: 'Regen' }).getAttribute('aria-keyshortcuts')).toBe('0');
  });

  it('lädt direkt zum Anbieter hoch, zeigt den Fortschritt und lädt danach die Liste neu', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValueOnce({ files: [], nextCursor: null }).mockResolvedValue({ files: [file('neu.mp3')], nextCursor: null });
    api.requestUpload.mockResolvedValue(target);
    render(Soundboard);
    await screen.findByText(/Noch keine Sounds/);

    const input = screen.getByLabelText(/Dateien wählen/) as HTMLInputElement;
    await user.upload(input, new File(['abc'], 'neu.mp3', { type: 'audio/mpeg' }));
    await waitFor(() => expect(FakeXhr.last).not.toBeNull());
    expect(api.requestUpload).toHaveBeenCalledWith(3, { fileName: 'neu.mp3', contentType: 'audio/mpeg', size: 3 });
    const xhr = FakeXhr.last!;
    // die Datei geht an den Anbieter, nicht an unseren Server
    expect([xhr.method, xhr.url]).toEqual(['PUT', target.url]);
    expect(xhr.body).toBeInstanceOf(File);

    xhr.progress(1, 2);
    expect((await screen.findByLabelText('Fortschritt neu.mp3')).getAttribute('value')).toBe('0.5');
    xhr.respond(200);
    expect(await screen.findByText('hochgeladen')).toBeTruthy();
    await screen.findByRole('button', { name: 'neu' });
    expect(api.storageFiles).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('combobox', { name: 'Typ von „neu“' }) as HTMLSelectElement).value).toBe('sfx');
  });

  it('ordnet hochgeladene Dateien dem gewählten Typ zu – auch ohne vorab bekannte Datei-ID', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles
      .mockResolvedValueOnce({ files: [], nextCursor: null })
      .mockResolvedValue({ files: [{ ...file('Kampfmusik.mp3'), id: 'drive-1' }], nextCursor: null });
    api.requestUpload.mockResolvedValue({ ...target, fileId: null });
    render(Soundboard);
    await screen.findByText(/Noch keine Sounds/);
    await user.selectOptions(screen.getByLabelText('Typ'), 'music');
    await user.upload(screen.getByLabelText(/Dateien wählen/) as HTMLInputElement, new File(['abc'], 'Kampfmusik.mp3', { type: 'audio/mpeg' }));
    await waitFor(() => expect(FakeXhr.last).not.toBeNull());
    FakeXhr.last!.respond(200);
    const select = (await screen.findByRole('combobox', { name: 'Typ von „Kampfmusik“' })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('music'));
    expect(JSON.parse(localStorage.getItem('pnp.soundboard.types')!)).toEqual({ '3:drive-1': 'music' });
  });

  it('lehnt Nicht-Audiodateien vor dem Upload ab', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [], nextCursor: null });
    render(Soundboard);
    await screen.findByText(/Noch keine Sounds/);
    await user.upload(screen.getByLabelText(/Dateien wählen/) as HTMLInputElement, new File(['x'], 'bild.png', { type: 'image/png' }));
    expect(await screen.findByText(/keine Audiodatei/)).toBeTruthy();
    expect(api.requestUpload).not.toHaveBeenCalled();
  });

  it('nimmt Dateien per Drag-and-drop an', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [], nextCursor: null });
    api.requestUpload.mockResolvedValue(target);
    render(Soundboard);
    await screen.findByText(/Noch keine Sounds/);
    const zone = screen.getByRole('region', { name: 'Hochladen' });
    // gezogene Playlist-Zeilen (keine Dateien) nimmt die Fläche nicht an
    expect(await fireEvent.dragOver(zone, { dataTransfer: { types: ['application/x-pnp-playlist-entry'] } })).toBe(true);
    expect(zone.classList.contains('dragging')).toBe(false);
    expect(await fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } })).toBe(false);
    expect(zone.classList.contains('dragging')).toBe(true);
    const dropped = new File(['abc'], 'neu.mp3', { type: 'audio/mpeg' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [dropped] } });
    zone.dispatchEvent(event);
    await waitFor(() => expect(api.requestUpload).toHaveBeenCalledWith(3, expect.objectContaining({ fileName: 'neu.mp3' })));
  });

  it('erklärt eine CORS-Sperre beim Upload und holt bei abgelaufenem Link einmal einen neuen', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [], nextCursor: null });
    api.requestUpload.mockResolvedValue(target);
    render(Soundboard);
    await screen.findByText(/Noch keine Sounds/);
    const input = screen.getByLabelText(/Dateien wählen/) as HTMLInputElement;

    await user.upload(input, new File(['a'], 'a.mp3', { type: 'audio/mpeg' }));
    await waitFor(() => expect(FakeXhr.last).not.toBeNull());
    const first = FakeXhr.last!;
    first.respond(403);
    await waitFor(() => expect(FakeXhr.last).not.toBe(first));
    expect(api.requestUpload).toHaveBeenCalledTimes(2);
    FakeXhr.last!.fail();
    expect(await screen.findByText(/CORS-Freigabe/)).toBeTruthy();
  });

  it('löscht eigene Dateien erst nach Bestätigung', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [file('Regen.mp3')], nextCursor: null });
    api.deleteStorageFile.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(Soundboard);
    const del = await screen.findByRole('button', { name: '„Regen“ löschen' });
    await user.click(del);
    expect(api.deleteStorageFile).not.toHaveBeenCalled();
    await user.click(del);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.deleteStorageFile).toHaveBeenCalledWith(3, 'sb/Regen.mp3');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Regen/ })).toBeNull());
  });

  it('vergisst den gewählten Typ einer gelöschten Datei', async () => {
    localStorage.setItem('pnp.soundboard.types', JSON.stringify({ '3:sb/Regen.mp3': 'music' }));
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [file('Regen.mp3')], nextCursor: null });
    api.deleteStorageFile.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(Soundboard);
    expect(((await screen.findByRole('combobox', { name: 'Typ von „Regen“' })) as HTMLSelectElement).value).toBe('music');
    await user.click(screen.getByRole('button', { name: '„Regen“ löschen' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Regen/ })).toBeNull());
    expect(JSON.parse(localStorage.getItem('pnp.soundboard.types')!)).toEqual({});
  });

  it('nimmt eine gelöschte Datei aus allen Playlisten; lief sie gerade, spielt der nächste Titel', async () => {
    localStorage.setItem('pnp.soundboard.types', JSON.stringify({ '3:sb/Regen.mp3': 'music' }));
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [file('Regen.mp3')], nextCursor: null });
    api.playbackUrl.mockResolvedValue({ url: 'https://bucket.example/sb/Regen.mp3?sig=get', expiresAt: '2099-01-01T00:00:00Z' });
    api.deleteStorageFile.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(Soundboard);
    await user.click(await screen.findByRole('button', { name: '„Regen“ zu einer neuen Playlist hinzufügen' }));
    await user.click(screen.getByRole('button', { name: '„Fanfare“ zu „Playlist 1“ hinzufügen' }));
    const status = () => within(screen.getByRole('region', { name: 'Playlisten' })).getByRole('status').textContent;
    await waitFor(() => expect(status()).toMatch(/Läuft: Regen · Titel 1 von 2/));
    await user.click(screen.getByRole('button', { name: '„Regen“ löschen' }));
    await waitFor(() => expect(status()).toMatch(/Läuft: Fanfare · Titel 1 von 1/));
    expect(within(screen.getByRole('list', { name: /^Titel von/ })).getAllByRole('listitem')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('pnp.soundboard.playlists')!).playlists[0].tracks).toEqual([
      expect.objectContaining({ sound: 'builtin:fanfare' }),
    ]);
  });

  it('nimmt eine gelöschte Datei aus der Effekt-Liste und stoppt ihre Einträge', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [file('Regen.mp3')], nextCursor: null });
    api.playbackUrl.mockResolvedValue({ url: 'https://bucket.example/sb/Regen.mp3?sig=get', expiresAt: '2099-01-01T00:00:00Z' });
    api.deleteStorageFile.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(Soundboard);
    await user.click(await screen.findByRole('button', { name: '„Regen“ zur Effekt-Liste hinzufügen' }));
    await user.click(screen.getByRole('button', { name: '„Glocke“ zur Effekt-Liste hinzufügen' }));
    const panel = screen.getByRole('region', { name: 'Effekt-Liste' });
    await waitFor(() => expect(within(panel).getByRole('button', { name: '„Regen“ in der Effekt-Liste stoppen' }).textContent).toBe('■'));
    const regen = (play.mock.contexts as HTMLAudioElement[]).find((a) => a.src.includes('Regen.mp3'))!;
    await user.click(screen.getByRole('button', { name: '„Regen“ löschen' }));
    await waitFor(() => expect(within(panel).queryByText('Regen')).toBeNull());
    expect(regen.getAttribute('src')).toBeNull();
    expect(within(panel).getByRole('button', { name: '„Glocke“ in der Effekt-Liste stoppen' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('pnp.soundboard.effects')!).entries).toEqual([expect.objectContaining({ sound: 'builtin:glocke' })]);
  });

  it('behält beim Aktualisieren eines Speichers die Titel laufender Playlisten', async () => {
    localStorage.setItem('pnp.soundboard.types', JSON.stringify({ '3:sb/Regen.mp3': 'music', '3:sb/Wind.mp3': 'music' }));
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [file('Regen.mp3'), file('Wind.mp3')], nextCursor: null });
    api.playbackUrl.mockImplementation(async (_cid: number, id: string) => ({ url: `https://bucket.example/${id}?sig=get`, expiresAt: '2099-01-01T00:00:00Z' }));
    render(Soundboard);
    await user.click(await screen.findByRole('button', { name: '„Regen“ zu einer neuen Playlist hinzufügen' }));
    await user.click(screen.getByRole('button', { name: '„Wind“ zu „Playlist 1“ hinzufügen' }));
    const status = () => within(screen.getByRole('region', { name: 'Playlisten' })).getByRole('status').textContent;
    await waitFor(() => expect(status()).toMatch(/Läuft: Regen · Titel 1 von 2/));

    // Liste lädt gerade neu, da endet der Titel: der nächste darf nicht als „nicht verfügbar“ übersprungen werden
    let finishLoading!: (page: { files: ReturnType<typeof file>[]; nextCursor: null }) => void;
    api.storageFiles.mockReturnValue(new Promise((resolve) => (finishLoading = resolve)));
    await user.click(within(screen.getByRole('region', { name: 'Mein Bucket' })).getByRole('button', { name: 'Aktualisieren' }));
    expect(within(screen.getByRole('region', { name: 'Mein Bucket' })).getByRole('button', { name: 'Regen' })).toBeTruthy();
    const regen = [...(play.mock.contexts as HTMLAudioElement[])].reverse().find((a) => a.src.includes('Regen.mp3'))!;
    regen.onended!(new Event('ended'));
    await waitFor(() => expect(status()).toMatch(/Läuft: Wind · Titel 2 von 2/));
    finishLoading({ files: [file('Regen.mp3'), file('Wind.mp3')], nextCursor: null });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Mein Bucket' })).getByRole('button', { name: 'Aktualisieren' }).hasAttribute('disabled')).toBe(false));
    expect(status()).toMatch(/Läuft: Wind/);
  });

  it('meldet getrennte Speicher verständlich und lädt deren Status neu', async () => {
    api.storageConnections
      .mockResolvedValueOnce([connection()])
      .mockResolvedValue([connection({ status: 'disconnected', statusMessage: 'Zugriff wurde widerrufen' })]);
    api.storageFiles.mockRejectedValue(new ApiFailure(409, 'Zugriff wurde widerrufen'));
    render(Soundboard);
    expect(await screen.findByText(/Zugriff wurde widerrufen\. Bitte den Speicher in den Kontoeinstellungen/)).toBeTruthy();
    expect(await screen.findByText('getrennt')).toBeTruthy();
    const section = screen.getByRole('region', { name: 'Mein Bucket' });
    expect(within(section).getByRole('link', { name: 'Kontoeinstellungen' })).toBeTruthy();
    // getrennte Speicher sind als Upload-Ziel gesperrt
    expect((screen.getByRole('option', { name: /Mein Bucket \(/ }) as HTMLOptionElement).disabled).toBe(true);
  });

  it('meldet, wenn der Anbieter beim Abspielen nicht erreichbar ist', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.storageFiles.mockResolvedValue({ files: [file('Regen.mp3')], nextCursor: null });
    api.playbackUrl.mockRejectedValue(new ApiFailure(502, 'Zeitüberschreitung'));
    render(Soundboard);
    await user.click(await screen.findByRole('button', { name: 'Regen' }));
    expect(await screen.findByText(/Anbieter ist gerade nicht erreichbar: Zeitüberschreitung/)).toBeTruthy();
  });
});
