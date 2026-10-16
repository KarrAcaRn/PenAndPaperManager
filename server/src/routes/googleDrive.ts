import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { MAX_STORAGE_DISPLAY_NAME_LENGTH, MAX_STORAGE_FILE_NAME_LENGTH } from '@pnp/shared';
import { getCurrentUser, requireUser } from '../auth.ts';
import { badRequest, forbidden } from '../errors.ts';
import { intParams, nonBlank, objectOf } from '../schemas.ts';
import { createConnection, getConnection, updateConnectionConfig, withProvider, type StorageContext } from '../storage/connections.ts';
import {
  GoogleDriveStorageProvider,
  createPkce,
  type GoogleDriveConfig,
  type GoogleDriveCredentials,
  type GoogleDriveDefinition,
} from '../storage/googleDrive.ts';
import { StorageProviderError } from '../storage/provider.ts';

// Google Drive: OAuth-Flow, Ordnerauswahl und Streaming der Wiedergabe (docs/soundboard-storage.md).
// Dateiliste, Upload, Löschen und Testen laufen über die allgemeinen /api/storage/connections/*-Endpunkte.

export const OAUTH_COOKIE = 'pnp_gdrive_oauth';
const OAUTH_PATH = '/api/storage/google-drive/oauth';
/** Wie lange die Anmeldung bei Google dauern darf */
const OAUTH_TTL_MS = 10 * 60 * 1000;
/** Ziel nach dem Callback: Einstellungen (Hash-Router des Clients); dort folgt die Ordnerauswahl */
export const SETTINGS_URL = '/#/settings';

const cidParams = intParams('cid');
const startQuery = objectOf({ displayName: nonBlank(MAX_STORAGE_DISPLAY_NAME_LENGTH) }, []);
const callbackQuery = objectOf(
  {
    code: { type: 'string', maxLength: 2048 },
    state: { type: 'string', maxLength: 256 },
    error: { type: 'string', maxLength: 256 },
  },
  [],
);
const folderQuery = objectOf({ cursor: { type: 'string', minLength: 1, maxLength: 4096 } }, []);
const folderBody = objectOf(
  {
    folderId: { type: 'string', minLength: 1, maxLength: 200 },
    name: nonBlank(MAX_STORAGE_FILE_NAME_LENGTH),
  },
  [],
);
const streamQuery = objectOf({ t: { type: 'string', minLength: 1, maxLength: 2048 } });

interface OAuthState {
  state: string;
  verifier: string;
  displayName: string | null;
  expiresAt: number;
}

/** Zustandsdaten des laufenden OAuth-Flows: verschlüsselt im Cookie, an den Nutzer gebunden */
const oauthAad = (userId: number) => `google_drive_oauth:${userId}`;

function driveDefinition(ctx: StorageContext): GoogleDriveDefinition {
  return ctx.providers.get('google_drive') as GoogleDriveDefinition;
}

/** Aktion mit dem Drive-Anbieter einer eigenen Verbindung (Status-Handling wie bei allen Anbietern) */
function withDrive<T>(ctx: StorageContext, userId: number, cid: number, action: (drive: GoogleDriveStorageProvider) => Promise<T>) {
  return withProvider(ctx, userId, cid, (provider) => {
    if (!(provider instanceof GoogleDriveStorageProvider)) throw badRequest('Das ist keine Google-Drive-Verbindung');
    return action(provider);
  });
}

function backToSettings(reply: FastifyReply, params: Record<string, string>) {
  return reply.redirect(`${SETTINGS_URL}?${new URLSearchParams(params)}`);
}

export function googleDriveRoutes(app: FastifyInstance, ctx: StorageContext): void {
  const { db } = ctx;
  const cookieOptions = { path: OAUTH_PATH, httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' };

  /** Startet die Verbindung: leitet zur Google-Anmeldung (Zustimmung zu drive.file) weiter. */
  app.get(`${OAUTH_PATH}/start`, { schema: { querystring: startQuery } }, (req, reply) => {
    const user = requireUser(db, req);
    const definition = driveDefinition(ctx);
    const { displayName } = req.query as { displayName?: string };
    const pkce = createPkce();
    const state: OAuthState = {
      state: randomBytes(24).toString('base64url'),
      verifier: pkce.verifier,
      displayName: displayName?.trim() || null,
      expiresAt: Date.now() + OAUTH_TTL_MS,
    };
    reply.setCookie(OAUTH_COOKIE, ctx.secrets().encrypt(JSON.stringify(state), oauthAad(user.id)), {
      ...cookieOptions,
      maxAge: OAUTH_TTL_MS / 1000,
    });
    return reply.redirect(definition.authorizationUrl(state.state, pkce.challenge));
  });

  /**
   * Rückkehr von Google: Code einlösen, Verbindung (noch ohne Ordner) anlegen und zur Ordnerauswahl in den
   * Einstellungen weiterleiten. Fehler landen als Text in ?storageError=…, nie mit Token oder Code.
   */
  app.get(`${OAUTH_PATH}/callback`, { schema: { querystring: callbackQuery } }, async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    const sealed = req.cookies[OAUTH_COOKIE];
    reply.clearCookie(OAUTH_COOKIE, cookieOptions);
    const fail = (message: string) => backToSettings(reply, { storageError: message });

    const user = getCurrentUser(db, req);
    if (!user) return fail('Bitte zuerst anmelden und dann Google Drive erneut verbinden');
    let pending: OAuthState | null = null;
    try {
      pending = sealed ? (JSON.parse(ctx.secrets().decrypt(sealed, oauthAad(user.id))) as OAuthState) : null;
    } catch {
      pending = null;
    }
    if (!pending || pending.expiresAt < Date.now() || !state || state !== pending.state) {
      return fail('Die Anmeldung bei Google ist abgelaufen oder ungültig – bitte erneut verbinden');
    }
    if (error || !code) {
      return fail(error === 'access_denied' ? 'Die Verbindung mit Google Drive wurde abgebrochen' : 'Google hat die Anmeldung abgelehnt');
    }

    try {
      const definition = driveDefinition(ctx);
      let credentials: GoogleDriveCredentials = await definition.exchangeCode(code, pending.verifier);
      const config: GoogleDriveConfig = { folderId: null, folderName: null, accountEmail: null };
      const provider = definition.create({ id: null, userId: user.id, config, credentials, saveCredentials: (next) => (credentials = next) });
      config.accountEmail = await (provider as GoogleDriveStorageProvider).accountEmail();
      const connection = createConnection(ctx, user.id, {
        providerType: 'google_drive',
        displayName: pending.displayName ?? (config.accountEmail ? `Google Drive (${config.accountEmail})` : 'Google Drive'),
        config,
        credentials,
      });
      return backToSettings(reply, { storageConnected: String(connection.id) });
    } catch (err) {
      if (err instanceof StorageProviderError) return fail(`Verbindung fehlgeschlagen: ${err.message}`);
      req.log.error({ err: err instanceof Error ? err.message : 'unbekannt' }, 'Google-Drive-Callback fehlgeschlagen');
      return fail('Verbindung fehlgeschlagen');
    }
  });

  /** Ordner, die die App sehen darf (mit drive.file: selbst angelegte bzw. per Picker freigegebene) */
  app.get(
    '/api/storage/google-drive/connections/:cid/folders',
    { schema: { params: cidParams, querystring: folderQuery } },
    async (req) => {
      const user = requireUser(db, req);
      const { cursor } = req.query as { cursor?: string };
      return withDrive(ctx, user.id, (req.params as { cid: number }).cid, (drive) => drive.listFolders(cursor));
    },
  );

  /** Ordner wählen ({ folderId }) oder neu anlegen ({ name }, z.B. „Soundboard“); speichert die Folder-ID. */
  app.put(
    '/api/storage/google-drive/connections/:cid/folder',
    { schema: { params: cidParams, body: folderBody } },
    async (req) => {
      const user = requireUser(db, req);
      const { cid } = req.params as { cid: number };
      const body = req.body as { folderId?: string; name?: string };
      if ((body.folderId === undefined) === (body.name === undefined)) throw badRequest('Entweder folderId oder name angeben');
      const folder = await withDrive(ctx, user.id, cid, (drive) =>
        body.name !== undefined ? drive.createFolder(body.name.trim()) : drive.getFolder(body.folderId!),
      );
      const config = getConnection(db, user.id, cid).config as GoogleDriveConfig;
      return updateConnectionConfig(db, user.id, cid, { ...config, folderId: folder.id, folderName: folder.name });
    },
  );

  /**
   * Wiedergabe: Drive bietet keine signierten Download-URLs, darum reicht unser Server die Datei durch. Der Zugang
   * steckt im kurzlebigen, signierten Ticket ?t= (aus getPlaybackUrl); Range-Anfragen gehen an Google weiter.
   */
  app.get('/api/storage/google-drive/stream', { schema: { querystring: streamQuery } }, async (req, reply) => {
    const target = driveDefinition(ctx).verifyStreamToken((req.query as { t: string }).t);
    if (!target) throw forbidden('Der Wiedergabe-Link ist ungültig oder abgelaufen');
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const media = await withDrive(ctx, target.userId, target.connectionId, (drive) => drive.openMedia(target.fileId, range));
    reply
      .code(media.status)
      .headers({
        ...media.headers,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
      });
    return reply.send(media.body ? Readable.fromWeb(media.body as import('node:stream/web').ReadableStream) : '');
  });
}
