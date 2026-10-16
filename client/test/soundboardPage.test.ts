import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
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

const tile = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('Soundboard ohne Login', () => {
  it('ist über #/sounds erreichbar und zeigt die Standard-Sounds statt des Logins', async () => {
    expect(parseHash('#/sounds')).toEqual({ name: 'sounds' });
    location.hash = '#/sounds';
    router.route = { name: 'sounds' };
    session.ready = false;
    api.me.mockResolvedValue({ user: null });
    render(App);
    expect(await screen.findByRole('heading', { name: 'Soundboard' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Glocke/ })).toBeTruthy();
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
    await screen.findByRole('button', { name: /Glocke/ });
    await user.type(screen.getByRole('searchbox'), 'trom');
    expect(screen.queryByRole('button', { name: /Glocke/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Trommelwirbel/ })).toBeTruthy();
    await user.clear(screen.getByRole('searchbox'));
    await user.selectOptions(screen.getByLabelText('Kategorie'), 'Musik');
    expect(screen.getByRole('button', { name: /Fanfare/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Glocke/ })).toBeNull();
  });

  it('meldet, wenn die Standard-Sounds nicht laden', async () => {
    api.builtinSounds.mockRejectedValue(new Error('Server weg'));
    render(Soundboard);
    expect(await screen.findByText(/Standard-Sounds konnten nicht geladen werden: Server weg/)).toBeTruthy();
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
    expect(await screen.findByRole('button', { name: /Glocke/ })).toBeTruthy();
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
