import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { StorageConnection, StorageProviderInfo } from '@pnp/shared';
import { ApiFailure } from '../src/lib/api.ts';
import { createTranslator } from '../src/lib/i18n.ts';
import { router } from '../src/lib/router.svelte.ts';
import StorageSettings from '../src/lib/storage/StorageSettings.svelte';
import Settings from '../src/routes/Settings.svelte';
import { mockApi, PLAYER, signIn } from './helpers.ts';

let api: ReturnType<typeof mockApi>;
const user = userEvent.setup();

const S3: StorageProviderInfo = { type: 's3', label: 'S3 (oder kompatibel)', manualSetup: true };
const DRIVE: StorageProviderInfo = { type: 'google_drive', label: 'Google Drive', manualSetup: false };
const SECRET = 'geheimes-secret-123';

const connection = (over: Partial<StorageConnection> = {}): StorageConnection => ({
  id: 1,
  providerType: 's3',
  displayName: 'Meine Sounds',
  config: { bucket: 'klang', region: 'eu-central-1', endpoint: null, prefix: 'soundboard' },
  status: 'connected',
  statusMessage: '',
  createdAt: '2026-10-16 10:00:00',
  updatedAt: '2026-10-16 10:00:00',
  ...over,
});

const drive = (over: Partial<StorageConnection> = {}) =>
  connection({
    id: 5,
    providerType: 'google_drive',
    displayName: 'Google Drive (alice@gmail.com)',
    config: { folderId: null, folderName: null, accountEmail: 'alice@gmail.com' },
    ...over,
  });

beforeEach(() => {
  api = mockApi();
  api.storageProviders.mockResolvedValue([S3, DRIVE]);
  api.storageConnections.mockResolvedValue([]);
  signIn(PLAYER);
});

const list = () => screen.getByRole('list', { name: 'Verbundene Speicher' });
const item = (name: string) => within(list()).getByRole('listitem', { name });

describe('Speicher-Einstellungen: Liste', () => {
  it('zeigt erst den Ladezustand, dann den Leerzustand', async () => {
    let resolve!: (value: unknown) => void;
    api.storageConnections.mockReturnValue(new Promise((r) => (resolve = r)));
    render(StorageSettings);
    expect(screen.getByText('Lade Speicher …')).toBeTruthy();
    resolve([]);
    expect(await screen.findByText('Noch kein Speicher verbunden.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Speicher hinzufügen' })).toBeTruthy();
  });

  it('zeigt einen Ladefehler und lädt auf Wunsch erneut', async () => {
    api.storageConnections.mockRejectedValueOnce(new ApiFailure(500, 'Interner Fehler'));
    render(StorageSettings);
    expect((await screen.findByRole('alert')).textContent).toContain('Speicher konnten nicht geladen werden: Interner Fehler');
    api.storageConnections.mockResolvedValue([connection()]);
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Meine Sounds')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('listet Verbindungen mit Name, Typ, Status und Angaben, Zugangsdaten nur maskiert', async () => {
    api.storageConnections.mockResolvedValue([
      connection(),
      drive({ config: { folderId: 'f1', folderName: 'Soundboard', accountEmail: 'alice@gmail.com' } }),
      connection({ id: 2, displayName: 'Altes Bucket', status: 'error', statusMessage: 'Bucket „alt“ gibt es nicht' }),
    ]);
    render(StorageSettings);
    await screen.findByText('Meine Sounds');
    const s3 = item('Meine Sounds');
    expect(within(s3).getByText('S3 (oder kompatibel)')).toBeTruthy();
    expect(within(s3).getByText('Verbunden')).toBeTruthy();
    expect(within(s3).getByText('klang')).toBeTruthy();
    expect(within(s3).getByText('soundboard')).toBeTruthy();
    expect(within(s3).getByText('••••••••')).toBeTruthy();
    expect(within(s3).queryByRole('textbox')).toBeNull();

    const gd = item('Google Drive (alice@gmail.com)');
    expect(within(gd).getByText('Google Drive')).toBeTruthy();
    expect(within(gd).getByText('Soundboard')).toBeTruthy();
    expect(within(gd).queryByRole('button', { name: 'Ordner wählen' })).toBeNull();

    const broken = item('Altes Bucket');
    expect(within(broken).getByText('Fehler')).toBeTruthy();
    expect(within(broken).getByText('Bucket „alt“ gibt es nicht')).toBeTruthy();
  });

  it('testet eine Verbindung und meldet den Erfolg', async () => {
    api.storageConnections.mockResolvedValue([connection({ status: 'error', statusMessage: 'Netz weg' })]);
    api.testStorageConnection.mockResolvedValue(connection());
    render(StorageSettings);
    await screen.findByText('Meine Sounds');
    await user.click(within(item('Meine Sounds')).getByRole('button', { name: 'Testen' }));
    expect(api.testStorageConnection).toHaveBeenCalledWith(1);
    expect(await within(item('Meine Sounds')).findByText('Verbindung funktioniert.')).toBeTruthy();
    expect(within(item('Meine Sounds')).getByText('Verbunden')).toBeTruthy();
    expect(within(item('Meine Sounds')).queryByText('Netz weg')).toBeNull();
  });

  it('zeigt einen fehlgeschlagenen Test und den neuen Status', async () => {
    api.storageConnections.mockResolvedValueOnce([connection()]);
    api.testStorageConnection.mockRejectedValue(new ApiFailure(409, 'Zugangsdaten ungültig'));
    api.storageConnections.mockResolvedValue([connection({ status: 'disconnected', statusMessage: 'Zugangsdaten ungültig' })]);
    render(StorageSettings);
    await screen.findByText('Meine Sounds');
    await user.click(within(item('Meine Sounds')).getByRole('button', { name: 'Testen' }));
    expect((await within(item('Meine Sounds')).findByRole('alert')).textContent).toBe('Test fehlgeschlagen: Zugangsdaten ungültig');
    expect(await within(item('Meine Sounds')).findByText('Getrennt')).toBeTruthy();
    expect(within(item('Meine Sounds')).getByText(/neu und entferne diesen Eintrag/)).toBeTruthy();
  });

  it('entfernt eine Verbindung erst nach Bestätigung', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.deleteStorageConnection.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(StorageSettings);
    await screen.findByText('Meine Sounds');

    await user.click(within(item('Meine Sounds')).getByRole('button', { name: 'Entfernen' }));
    expect(confirm).toHaveBeenCalledWith('Speicher „Meine Sounds“ entfernen? Die Dateien beim Anbieter bleiben erhalten.');
    expect(api.deleteStorageConnection).not.toHaveBeenCalled();

    await user.click(within(item('Meine Sounds')).getByRole('button', { name: 'Entfernen' }));
    expect(api.deleteStorageConnection).toHaveBeenCalledWith(1);
    expect(await screen.findByText('„Meine Sounds“ wurde entfernt. Die Dateien beim Anbieter bleiben erhalten.')).toBeTruthy();
    expect(screen.getByText('Noch kein Speicher verbunden.')).toBeTruthy();
  });

  it('meldet einen Fehler beim Entfernen und behält die Verbindung', async () => {
    api.storageConnections.mockResolvedValue([connection()]);
    api.deleteStorageConnection.mockRejectedValue(new Error('Failed to fetch'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(StorageSettings);
    await screen.findByText('Meine Sounds');
    await user.click(within(item('Meine Sounds')).getByRole('button', { name: 'Entfernen' }));
    expect((await within(item('Meine Sounds')).findByRole('alert')).textContent).toBe('Entfernen fehlgeschlagen: Failed to fetch');
  });
});

describe('Speicher-Einstellungen: S3 hinzufügen', () => {
  async function openS3Form() {
    render(StorageSettings);
    await user.click(await screen.findByRole('button', { name: 'Speicher hinzufügen' }));
    await user.click(screen.getByRole('radio', { name: 'S3 (oder kompatibel)' }));
    return screen.getByRole('form', { name: 'S3 (oder kompatibel)' });
  }

  async function fill(form: HTMLElement) {
    await user.type(within(form).getByLabelText('Access Key ID'), 'AKIAEXAMPLE');
    await user.type(within(form).getByLabelText('Secret Access Key'), SECRET);
    await user.type(within(form).getByLabelText('Bucket'), 'klang');
    await user.type(within(form).getByLabelText(/^Region/), 'eu-central-1');
    await user.type(within(form).getByLabelText(/^Prefix/), 'soundboard');
  }

  it('prüft die Verbindung beim Speichern und zeigt das Secret danach nicht mehr', async () => {
    let resolve!: (value: StorageConnection) => void;
    api.createStorageConnection.mockReturnValue(new Promise((r) => (resolve = r)));
    const form = await openS3Form();
    expect((within(form).getByLabelText('Secret Access Key') as HTMLInputElement).type).toBe('password');
    await fill(form);
    await user.click(within(form).getByRole('button', { name: 'Verbindung testen und speichern' }));

    expect(api.createStorageConnection).toHaveBeenCalledWith({
      providerType: 's3',
      displayName: 'S3: klang',
      config: { bucket: 'klang', region: 'eu-central-1', endpoint: '', prefix: 'soundboard' },
      credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: SECRET },
    });
    expect(within(form).getByRole('button', { name: 'Verbindung wird geprüft …' })).toHaveProperty('disabled', true);

    resolve(connection({ displayName: 'S3: klang' }));
    expect(await screen.findByText('„S3: klang“ wurde verbunden.')).toBeTruthy();
    expect(item('S3: klang')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'S3 (oder kompatibel)' })).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain('AKIAEXAMPLE');
  });

  it('übernimmt einen eigenen Namen und den Endpoint', async () => {
    api.createStorageConnection.mockResolvedValue(connection({ displayName: 'R2' }));
    const form = await openS3Form();
    await user.type(within(form).getByLabelText('Name'), '  R2 ');
    await fill(form);
    await user.type(within(form).getByLabelText(/^Endpoint/), 'https://konto.r2.cloudflarestorage.com');
    await user.click(within(form).getByRole('button', { name: 'Verbindung testen und speichern' }));
    expect(api.createStorageConnection).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'R2', config: expect.objectContaining({ endpoint: 'https://konto.r2.cloudflarestorage.com' }) }),
    );
  });

  it('zeigt einen fehlgeschlagenen Verbindungstest und speichert nichts', async () => {
    api.createStorageConnection.mockRejectedValue(
      new ApiFailure(409, 'Zugriff verweigert: Die Zugangsdaten dürfen Dateien hochladen (s3:PutObject) nicht'),
    );
    const form = await openS3Form();
    await fill(form);
    await user.click(within(form).getByRole('button', { name: 'Verbindung testen und speichern' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Nicht gespeichert – Zugriff verweigert: Die Zugangsdaten dürfen Dateien hochladen (s3:PutObject) nicht',
    );
    expect(screen.getByText('Noch kein Speicher verbunden.')).toBeTruthy();
    // Eingaben bleiben zum Korrigieren stehen
    expect((within(form).getByLabelText('Bucket') as HTMLInputElement).value).toBe('klang');
  });

  it('weist auf CORS hin und verlinkt die Anleitung', async () => {
    const form = await openS3Form();
    expect(within(form).getByText('Wichtig: CORS im Bucket erlauben')).toBeTruthy();
    expect(within(form).getByText(/"AllowedMethods"/).textContent).toContain(location.origin);
    const link = within(form).getByRole('link', { name: 'Anleitung zu CORS und empfohlenen Rechten' }) as HTMLAnchorElement;
    expect(link.href).toContain('docs/soundboard-storage.md#cors-konfiguration-des-buckets');
  });

  it('lässt sich abbrechen', async () => {
    const form = await openS3Form();
    await user.click(within(form).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('form', { name: 'S3 (oder kompatibel)' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Speicher hinzufügen' })).toBeTruthy();
  });

  it('meldet, wenn kein Anbieter eingerichtet ist', async () => {
    api.storageProviders.mockResolvedValue([]);
    render(StorageSettings);
    await user.click(await screen.findByRole('button', { name: 'Speicher hinzufügen' }));
    expect(screen.getByText('Auf diesem Server ist kein Speicheranbieter eingerichtet.')).toBeTruthy();
  });

  it('zeigt bei nur einem Anbieter gleich dessen Formular', async () => {
    api.storageProviders.mockResolvedValue([S3]);
    render(StorageSettings);
    await user.click(await screen.findByRole('button', { name: 'Speicher hinzufügen' }));
    expect(screen.getByRole('form', { name: 'S3 (oder kompatibel)' })).toBeTruthy();
  });
});

describe('Speicher-Einstellungen: Google Drive', () => {
  it('startet die Google-Anmeldung mit dem gewählten Namen', async () => {
    api.connectGoogleDrive.mockResolvedValue(undefined);
    render(StorageSettings);
    await user.click(await screen.findByRole('button', { name: 'Speicher hinzufügen' }));
    await user.click(screen.getByRole('radio', { name: 'Google Drive' }));
    await user.type(screen.getByLabelText('Name (optional)'), 'Kampagne');
    await user.click(screen.getByRole('button', { name: 'Mit Google verbinden' }));
    expect(api.connectGoogleDrive).toHaveBeenCalledWith('Kampagne');
    expect(screen.getByRole('button', { name: 'Weiterleitung zu Google …' })).toHaveProperty('disabled', true);
  });

  it('startet ohne Namen mit der Vorgabe des Servers', async () => {
    api.connectGoogleDrive.mockResolvedValue(undefined);
    render(StorageSettings);
    await user.click(await screen.findByRole('button', { name: 'Speicher hinzufügen' }));
    await user.click(screen.getByRole('radio', { name: 'Google Drive' }));
    await user.click(screen.getByRole('button', { name: 'Mit Google verbinden' }));
    expect(api.connectGoogleDrive).toHaveBeenCalledWith(undefined);
  });

  it('öffnet nach der Rückkehr die Ordnerauswahl und legt den Ordner „Soundboard“ an', async () => {
    api.storageConnections.mockResolvedValue([drive()]);
    api.driveFolders.mockResolvedValue({ folders: [], nextCursor: null });
    api.chooseDriveFolder.mockResolvedValue(drive({ config: { folderId: 'f9', folderName: 'Soundboard', accountEmail: 'alice@gmail.com' } }));
    const onParamsHandled = vi.fn();
    render(StorageSettings, { connectedId: 5, onParamsHandled });

    expect(await screen.findByText('Google Drive ist verbunden. Wähle jetzt den Ordner für deine Sounds.')).toBeTruthy();
    expect(onParamsHandled).toHaveBeenCalled();
    const picker = screen.getByRole('form', { name: 'Ordner in Google Drive wählen' });
    expect(api.driveFolders).toHaveBeenCalledWith(5, undefined);
    expect(await within(picker).findByText(/kennt noch keine Ordner/)).toBeTruthy();
    expect((within(picker).getByLabelText('Name des neuen Ordners') as HTMLInputElement).value).toBe('Soundboard');
    expect(within(item('Google Drive (alice@gmail.com)')).getByText('noch nicht gewählt')).toBeTruthy();

    await user.click(within(picker).getByRole('button', { name: 'Ordner übernehmen' }));
    expect(api.chooseDriveFolder).toHaveBeenCalledWith(5, { name: 'Soundboard' });
    expect(await screen.findByText('Ordner „Soundboard“ ist gewählt.')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Ordner in Google Drive wählen' })).toBeNull();
    expect(within(item('Google Drive (alice@gmail.com)')).getByText('Soundboard')).toBeTruthy();
  });

  it('wählt einen vorhandenen Ordner, auch von weiteren Seiten', async () => {
    api.storageConnections.mockResolvedValue([drive()]);
    api.driveFolders
      .mockResolvedValueOnce({ folders: [{ id: 'a', name: 'Musik' }], nextCursor: 'n1' })
      .mockResolvedValueOnce({ folders: [{ id: 'b', name: 'Effekte' }], nextCursor: null });
    api.chooseDriveFolder.mockResolvedValue(drive({ config: { folderId: 'b', folderName: 'Effekte', accountEmail: null } }));
    render(StorageSettings);
    await user.click(await screen.findByRole('button', { name: 'Ordner wählen' }));
    const picker = screen.getByRole('form', { name: 'Ordner in Google Drive wählen' });
    await user.click(await within(picker).findByRole('button', { name: 'Weitere Ordner laden' }));
    expect(api.driveFolders).toHaveBeenLastCalledWith(5, 'n1');
    await user.click(await within(picker).findByRole('radio', { name: 'Effekte' }));
    expect(within(picker).getByRole('radio', { name: 'Musik' })).toBeTruthy();
    await user.click(within(picker).getByRole('button', { name: 'Ordner übernehmen' }));
    expect(api.chooseDriveFolder).toHaveBeenCalledWith(5, { folderId: 'b' });
    expect(await screen.findByText('Ordner „Effekte“ ist gewählt.')).toBeTruthy();
  });

  it('meldet Fehler der Ordnerauswahl', async () => {
    api.storageConnections.mockResolvedValue([drive()]);
    api.driveFolders.mockRejectedValueOnce(new ApiFailure(502, 'Google Drive ist nicht erreichbar'));
    render(StorageSettings, { connectedId: 5 });
    const picker = await screen.findByRole('form', { name: 'Ordner in Google Drive wählen' });
    expect((await within(picker).findByRole('alert')).textContent).toContain('Google Drive ist nicht erreichbar');
    api.driveFolders.mockResolvedValue({ folders: [{ id: 'a', name: 'Musik' }], nextCursor: null });
    await user.click(within(picker).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(picker).findByRole('radio', { name: 'Musik' })).toBeTruthy();

    api.chooseDriveFolder.mockRejectedValue(new ApiFailure(404, 'Ordner nicht gefunden'));
    await user.click(within(picker).getByRole('radio', { name: 'Musik' }));
    await user.click(within(picker).getByRole('button', { name: 'Ordner übernehmen' }));
    expect((await within(picker).findByRole('alert')).textContent).toBe('Ordner konnte nicht gespeichert werden: Ordner nicht gefunden');
  });

  it('zeigt einen Fehler der Google-Anmeldung', async () => {
    const onParamsHandled = vi.fn();
    render(StorageSettings, { oauthError: 'Die Verbindung mit Google Drive wurde abgebrochen', onParamsHandled });
    expect(screen.getByRole('alert').textContent).toBe(
      'Google Drive konnte nicht verbunden werden: Die Verbindung mit Google Drive wurde abgebrochen',
    );
    await screen.findByText('Noch kein Speicher verbunden.');
    expect(onParamsHandled).toHaveBeenCalled();
  });
});

describe('Einstellungsseite mit Speicher', () => {
  it('übernimmt die Rückkehr aus der Google-Anmeldung und räumt die Adresse auf', async () => {
    api.settings.mockResolvedValue({ theme: 'system' });
    api.storageConnections.mockResolvedValue([drive()]);
    api.driveFolders.mockResolvedValue({ folders: [], nextCursor: null });
    history.replaceState(null, '', '#/settings?storageConnected=5');
    router.route = { name: 'settings', storageConnected: 5 };
    render(Settings);
    expect(await screen.findByRole('form', { name: 'Ordner in Google Drive wählen' })).toBeTruthy();
    await waitFor(() => expect(location.hash).toBe('#/settings'));
    expect(router.route).toEqual({ name: 'settings' });
    expect(screen.getByRole('heading', { name: 'Speicher' })).toBeTruthy();
  });
});

describe('Übersetzungen', () => {
  it('setzt Platzhalter ein und fällt auf Deutsch zurück', () => {
    let locale = 'en';
    const t = createTranslator<{ hello: string; bye: string }>(
      { de: { hello: 'Hallo {name}', bye: 'Tschüss' }, en: { hello: 'Hello {name}' } },
      () => locale,
    );
    expect(t('hello', { name: 'Beni' })).toBe('Hello Beni');
    expect(t('bye')).toBe('Tschüss');
    locale = 'fr';
    expect(t('hello', { name: 'Beni' })).toBe('Hallo Beni');
    expect(t('hello')).toBe('Hallo {name}');
  });
});
