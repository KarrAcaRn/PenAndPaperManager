import type { StorageConfig, StorageConnection, StorageConnectionStatus, StorageProviderType } from '@pnp/shared';
import { allRows, getRow, insertRow, parseJson, run, type Db } from '../db.ts';
import { HttpError, notFound } from '../errors.ts';
import type { SecretBox } from '../secrets.ts';
import { StorageProviderError, type StorageErrorKind, type StorageProvider } from './provider.ts';
import type { StorageProviderRegistry } from './registry.ts';

// Datenmodell UserStorageConnection (Tabelle user_storage_connections) und der Weg von einer gespeicherten
// Verbindung zum Anbieter. Zugangsdaten werden nur hier ver- und entschlüsselt und verlassen den Server nie.

export interface StorageContext {
  db: Db;
  /** erst bei Bedarf geladen, damit Server ohne Speicher-Nutzung keinen Schlüssel brauchen */
  secrets: () => SecretBox;
  providers: StorageProviderRegistry;
}

interface ConnectionRow {
  id: number;
  user_id: number;
  provider_type: StorageProviderType;
  display_name: string;
  config: string;
  credentials: string;
  status: StorageConnectionStatus;
  status_message: string;
  created_at: string;
  updated_at: string;
}

/** Bindet den Geheimtext an Besitzer und Anbieter: in eine fremde Zeile kopiert, lässt er sich nicht entschlüsseln. */
const credentialsAad = (userId: number, type: StorageProviderType) => `user_storage_connections:${userId}:${type}`;

/** API-Form einer Verbindung – bewusst ohne credentials */
function toConnection(row: ConnectionRow): StorageConnection {
  return {
    id: row.id,
    providerType: row.provider_type,
    displayName: row.display_name,
    config: parseJson<StorageConfig>(row.config, {}),
    status: row.status,
    statusMessage: row.status_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = 'SELECT * FROM user_storage_connections';

export function listConnections(db: Db, userId: number): StorageConnection[] {
  return allRows<ConnectionRow>(db, `${SELECT} WHERE user_id = ? ORDER BY display_name COLLATE NOCASE, id`, userId).map(toConnection);
}

/** Verbindung des Nutzers; fremde Verbindungen gelten als nicht vorhanden (404, verrät nichts). */
export function loadConnection(db: Db, userId: number, id: number): ConnectionRow {
  const row = getRow<ConnectionRow>(db, `${SELECT} WHERE id = ? AND user_id = ?`, id, userId);
  if (!row) throw notFound('Speicher-Verbindung nicht gefunden');
  return row;
}

export function getConnection(db: Db, userId: number, id: number): StorageConnection {
  return toConnection(loadConnection(db, userId, id));
}

export interface NewConnection {
  providerType: StorageProviderType;
  displayName: string;
  config: StorageConfig;
  credentials: unknown;
}

/** Legt eine Verbindung an; auch für eigene Flows der Anbieter (OAuth-Callback). */
export function createConnection(ctx: StorageContext, userId: number, input: NewConnection): StorageConnection {
  const sealed = ctx.secrets().encrypt(JSON.stringify(input.credentials), credentialsAad(userId, input.providerType));
  const id = insertRow(
    ctx.db,
    `INSERT INTO user_storage_connections (user_id, provider_type, display_name, config, credentials) VALUES (?, ?, ?, ?, ?)`,
    userId,
    input.providerType,
    input.displayName,
    JSON.stringify(input.config),
    sealed,
  );
  return getConnection(ctx.db, userId, id);
}

/**
 * "connect": prüft eine neue Verbindung beim Anbieter und speichert sie nur, wenn das klappt.
 * Ändert der Anbieter dabei die Zugangsdaten (Token-Refresh), wird der neue Stand gespeichert.
 */
export async function connect(ctx: StorageContext, userId: number, input: NewConnection): Promise<StorageConnection> {
  const definition = ctx.providers.get(input.providerType);
  let credentials = input.credentials;
  const provider = definition.create({
    id: null,
    userId,
    config: input.config,
    credentials,
    saveCredentials: (next) => (credentials = next),
  });
  try {
    await provider.validate();
  } catch (err) {
    if (err instanceof StorageProviderError) {
      throw new HttpError(err.kind === 'unavailable' ? 502 : 400, `Verbindung fehlgeschlagen: ${err.message}`);
    }
    throw err;
  }
  return createConnection(ctx, userId, { ...input, credentials });
}

/** Entfernt nur die Verknüpfung; die Dateien beim Anbieter bleiben unangetastet. */
export function deleteConnection(db: Db, userId: number, id: number): void {
  if (!run(db, 'DELETE FROM user_storage_connections WHERE id = ? AND user_id = ?', id, userId)) {
    throw notFound('Speicher-Verbindung nicht gefunden');
  }
}

export function setConnectionStatus(db: Db, id: number, status: StorageConnectionStatus, message = ''): void {
  run(
    db,
    `UPDATE user_storage_connections SET status = ?, status_message = ?, updated_at = datetime('now')
     WHERE id = ? AND (status <> ? OR status_message <> ?)`,
    status,
    message,
    id,
    status,
    message,
  );
}

function saveCredentials(ctx: StorageContext, row: ConnectionRow, credentials: unknown): void {
  const sealed = ctx.secrets().encrypt(JSON.stringify(credentials), credentialsAad(row.user_id, row.provider_type));
  run(ctx.db, `UPDATE user_storage_connections SET credentials = ?, updated_at = datetime('now') WHERE id = ?`, sealed, row.id);
}

const STATUS_CODES: Record<StorageErrorKind, number> = {
  invalid: 400,
  not_found: 404,
  auth: 409,
  permission: 409,
  unavailable: 502,
};

/** Fehler eines Anbieters als HTTP-Fehler; was die Verbindung selbst betrifft, landet im Status. */
function failure(db: Db, id: number, err: StorageProviderError): HttpError {
  if (err.kind === 'auth') setConnectionStatus(db, id, 'disconnected', err.message);
  if (err.kind === 'permission' || err.kind === 'unavailable') setConnectionStatus(db, id, 'error', err.message);
  return new HttpError(STATUS_CODES[err.kind], err.message);
}

function openProvider(ctx: StorageContext, row: ConnectionRow): StorageProvider {
  const definition = ctx.providers.get(row.provider_type);
  let credentials: unknown;
  try {
    credentials = JSON.parse(ctx.secrets().decrypt(row.credentials, credentialsAad(row.user_id, row.provider_type)));
  } catch {
    // z.B. Server-Schlüssel ausgetauscht – die Daten sind verloren, nur Neuverbinden hilft
    throw new StorageProviderError('auth', 'Die gespeicherten Zugangsdaten sind nicht mehr lesbar – bitte den Speicher neu verbinden');
  }
  return definition.create({
    id: row.id,
    userId: row.user_id,
    config: parseJson<StorageConfig>(row.config, {}),
    credentials,
    saveCredentials: (next) => saveCredentials(ctx, row, next),
  });
}

/**
 * Führt eine Aktion mit dem Anbieter einer Verbindung des Nutzers aus. Erfolg setzt den Status wieder auf
 * "connected", Anbieterfehler werden zu HTTP-Fehlern und ggf. zum Status "error"/"disconnected".
 */
export async function withProvider<T>(
  ctx: StorageContext,
  userId: number,
  id: number,
  action: (provider: StorageProvider) => Promise<T>,
): Promise<T> {
  const row = loadConnection(ctx.db, userId, id);
  try {
    const result = await action(openProvider(ctx, row));
    setConnectionStatus(ctx.db, row.id, 'connected');
    return result;
  } catch (err) {
    if (err instanceof StorageProviderError) throw failure(ctx.db, row.id, err);
    throw err;
  }
}
