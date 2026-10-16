import { createTranslator } from '../i18n.ts';

// Texte der Speicher-Einstellungen (Soundboard). Weitere Sprachen: eigenen Katalog ergänzen, z.B. `en: { … }`;
// fehlende Texte fallen auf Deutsch zurück.

const de = {
  title: 'Speicher',
  intro:
    'Eigene Lieder und Sounds fürs Soundboard liegen in deinem eigenen Speicher (S3 oder Google Drive). Unser Server ' +
    'speichert keine Dateien, er vermittelt nur den Zugriff.',
  loading: 'Lade Speicher …',
  loadError: 'Speicher konnten nicht geladen werden: {error}',
  retry: 'Erneut versuchen',
  empty: 'Noch kein Speicher verbunden.',
  listLabel: 'Verbundene Speicher',

  'provider.s3': 'S3 (oder kompatibel)',
  'provider.google_drive': 'Google Drive',

  'status.connected': 'Verbunden',
  'status.error': 'Fehler',
  'status.disconnected': 'Getrennt',
  disconnectedHint: 'Der Zugriff ist nicht mehr gültig. Verbinde den Speicher neu und entferne diesen Eintrag.',

  'detail.type': 'Typ',
  'detail.status': 'Status',
  'detail.bucket': 'Bucket',
  'detail.region': 'Region',
  'detail.endpoint': 'Endpoint',
  'detail.prefix': 'Prefix',
  'detail.account': 'Google-Konto',
  'detail.folder': 'Ordner',
  'detail.credentials': 'Zugangsdaten',
  credentialsMasked: '••••••••',
  credentialsHint: 'verschlüsselt gespeichert, werden nie wieder angezeigt',
  noFolder: 'noch nicht gewählt',

  test: 'Testen',
  testing: 'Teste …',
  testOk: 'Verbindung funktioniert.',
  testFailed: 'Test fehlgeschlagen: {error}',
  chooseFolder: 'Ordner wählen',
  remove: 'Entfernen',
  removing: 'Entferne …',
  removeConfirm: 'Speicher „{name}“ entfernen? Die Dateien beim Anbieter bleiben erhalten.',
  removed: '„{name}“ wurde entfernt. Die Dateien beim Anbieter bleiben erhalten.',
  removeFailed: 'Entfernen fehlgeschlagen: {error}',

  add: 'Speicher hinzufügen',
  cancel: 'Abbrechen',
  providerLegend: 'Anbieter',
  noProviders: 'Auf diesem Server ist kein Speicheranbieter eingerichtet.',
  unsupportedProvider: 'Dieser Anbieter lässt sich hier noch nicht einrichten.',
  added: '„{name}“ wurde verbunden.',

  's3.displayName': 'Name',
  's3.displayNameHint': 'Frei wählbar, nur für dich sichtbar. Leer lassen für „S3: <Bucket>“.',
  's3.defaultName': 'S3: {bucket}',
  's3.accessKeyId': 'Access Key ID',
  's3.secretAccessKey': 'Secret Access Key',
  's3.secretHint': 'Wird verschlüsselt gespeichert und danach nie wieder angezeigt.',
  's3.bucket': 'Bucket',
  's3.region': 'Region',
  's3.regionHint': 'z.B. eu-central-1; leer = us-east-1; Cloudflare R2: auto',
  's3.endpoint': 'Endpoint (optional)',
  's3.endpointHint': 'Nur für S3-kompatible Dienste (MinIO, Wasabi, R2, …), z.B. https://<konto>.r2.cloudflarestorage.com',
  's3.prefix': 'Prefix (optional)',
  's3.prefixHint': 'Ordner im Bucket, z.B. soundboard',
  's3.submit': 'Verbindung testen und speichern',
  's3.submitting': 'Verbindung wird geprüft …',
  's3.failed': 'Nicht gespeichert – {error}',
  's3.corsTitle': 'Wichtig: CORS im Bucket erlauben',
  's3.corsText':
    'Dein Browser lädt Dateien direkt in den Bucket hoch und spielt sie direkt daraus ab. Dafür muss der Bucket ' +
    'Anfragen von dieser Seite erlauben (CORS). Der Verbindungstest kann das nicht prüfen. Beispiel-Konfiguration:',
  's3.corsLink': 'Anleitung zu CORS und empfohlenen Rechten',

  'drive.text':
    'Du wirst zu Google weitergeleitet und erlaubst dort den Zugriff. Die App sieht nur Ordner und Dateien, die sie ' +
    'selbst angelegt hat. Danach wählst du hier den Ordner für deine Sounds.',
  'drive.displayName': 'Name (optional)',
  'drive.displayNameHint': 'Leer lassen für „Google Drive (<E-Mail>)“.',
  'drive.connect': 'Mit Google verbinden',
  'drive.connecting': 'Weiterleitung zu Google …',
  'drive.connected': 'Google Drive ist verbunden. Wähle jetzt den Ordner für deine Sounds.',
  'drive.oauthError': 'Google Drive konnte nicht verbunden werden: {error}',
  'drive.unknownConnection': 'Die neue Google-Drive-Verbindung wurde nicht gefunden.',

  'folder.title': 'Ordner in Google Drive wählen',
  'folder.for': 'für „{name}“',
  'folder.loading': 'Lade Ordner …',
  'folder.loadError': 'Ordner konnten nicht geladen werden: {error}',
  'folder.create': 'Neuen Ordner anlegen (empfohlen)',
  'folder.newName': 'Name des neuen Ordners',
  'folder.defaultName': 'Soundboard',
  'folder.existing': 'Vorhandene Ordner',
  'folder.none': 'Die App kennt noch keine Ordner in deinem Drive – lege einen neuen an.',
  'folder.more': 'Weitere Ordner laden',
  'folder.submit': 'Ordner übernehmen',
  'folder.submitting': 'Speichere …',
  'folder.saved': 'Ordner „{folder}“ ist gewählt.',
  'folder.failed': 'Ordner konnte nicht gespeichert werden: {error}',
  'folder.later': 'Später',
};

export type StorageMessageKey = keyof typeof de;

export const t = createTranslator<Record<StorageMessageKey, string>>({ de });
