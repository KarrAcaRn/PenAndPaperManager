import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler, preValidationHookHandler } from 'fastify';
import { canAccessSection, type Role, type Section, type SessionUser, type User } from '@pnp/shared';
import { getRow, run, type Db } from './db.ts';
import { adminOnly, forbidden, gmOnly, unauthorized } from './errors.ts';

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 30;
export const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

/** Seitenweite Admins stehen in der Konfiguration (ADMIN_EMAILS, kommagetrennt), nicht in der Datenbank. */
export type AdminEmails = ReadonlySet<string>;

export function parseAdminEmails(list: string | undefined): AdminEmails {
  return new Set((list ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
}

const isAdmin = (user: User, admins: AdminEmails): boolean => admins.has(user.email.toLowerCase());

export function toSessionUser(user: User, admins: AdminEmails): SessionUser {
  return { ...user, isAdmin: isAdmin(user, admins) };
}

export function requireAdmin(db: Db, req: FastifyRequest, admins: AdminEmails): User {
  const user = requireUser(db, req);
  if (!isAdmin(user, admins)) throw adminOnly();
  return user;
}

export function findOrCreateUser(db: Db, email: string): User {
  const normalized = email.trim().toLowerCase();
  run(db, 'INSERT INTO users (email) VALUES (?) ON CONFLICT (email) DO NOTHING', normalized);
  return getRow<User>(db, 'SELECT id, email FROM users WHERE email = ?', normalized)!;
}

// --- Sessions ---------------------------------------------------------------------------------------------------
// Serverseitig gespeichert (nur der Hash des Tokens), damit Logout und Widerruf wirken.
// Ablauf absolut SESSION_DAYS nach dem Login, ohne Verlängerung bei Benutzung.

/** Zeitstempel im Format von SQLites datetime() (UTC), damit Vergleiche in SQL als Text funktionieren */
const sqlTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Nur Tokens in dem Format, das createSession erzeugt, gehen überhaupt an die Datenbank */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function readToken(req: FastifyRequest): string | null {
  const token = req.cookies[SESSION_COOKIE];
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

/** Legt eine neue Session an und setzt das Cookie. Räumt dabei abgelaufene Sessions auf. */
export function createSession(db: Db, userId: number, reply: FastifyReply): void {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  deleteExpiredSessions(db, now);
  run(
    db,
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    hashToken(token),
    userId,
    sqlTime(now),
    sqlTime(now + SESSION_MS),
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_MS / 1000,
  });
}

/** Beendet die aktuelle Session (andere Geräte bleiben eingeloggt) und löscht das Cookie. */
export function destroySession(db: Db, req: FastifyRequest, reply: FastifyReply): void {
  const token = readToken(req);
  if (token) run(db, 'DELETE FROM sessions WHERE token_hash = ?', hashToken(token));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Widerruft alle Sessions eines Nutzers (z.B. nach Missbrauchsverdacht). */
export function destroyAllSessions(db: Db, userId: number): number {
  return run(db, 'DELETE FROM sessions WHERE user_id = ?', userId);
}

/** Löscht abgelaufene Sessions; geprüft wird der Ablauf ohnehin bei jedem Zugriff. */
export function deleteExpiredSessions(db: Db, now = Date.now()): number {
  return run(db, 'DELETE FROM sessions WHERE expires_at <= ?', sqlTime(now));
}

/** Der eingeloggte Nutzer oder null bei fehlendem, unbekanntem oder abgelaufenem Cookie. */
export function getCurrentUser(db: Db, req: FastifyRequest): User | null {
  const token = readToken(req);
  if (!token) return null;
  const user = getRow<User>(
    db,
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    hashToken(token),
    sqlTime(Date.now()),
  );
  return user ?? null;
}

export function requireUser(db: Db, req: FastifyRequest): User {
  const user = getCurrentUser(db, req);
  if (!user) throw unauthorized();
  return user;
}

/** Login-Seite der SPA (Hash-Router); das Ziel nach dem Login merkt sich der Client selbst */
export const LOGIN_PAGE = '/#/login';

/**
 * API-Pfade, die ohne Login erreichbar sein müssen (Login selbst, Abfrage des Login-Status, Logout). Dazu die
 * Google-Drive-Endpunkte, die selbst prüfen: der OAuth-Callback leitet ohne Login mit Fehlermeldung zurück in die
 * Einstellungen (statt rohem 401 im Browserfenster), der Stream ist über sein signiertes Ticket berechtigt.
 */
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  '/api/auth/request-code',
  '/api/auth/verify-code',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/storage/google-drive/oauth/callback',
  '/api/storage/google-drive/stream',
]);

/**
 * Guard als preHandler-Hook: API-Aufrufe (/api/…) ohne gültige Session bekommen 401,
 * Seitenaufrufe werden auf die Login-Seite umgeleitet.
 */
export function requireAuth(db: Db): preHandlerHookHandler {
  return async (req, reply) => {
    if (getCurrentUser(db, req)) return;
    if (apiPath(req).startsWith('/api/')) throw unauthorized();
    return reply.redirect(LOGIN_PAGE);
  };
}

/**
 * Pfad so, wie der Router ihn sieht: Fastify dekodiert Prozent-Kodierungen (`/%61pi/…` trifft `/api/…`),
 * deshalb hier ebenfalls dekodiert vergleichen. Nicht dekodierbare Pfade bleiben roh.
 */
export function apiPath(req: FastifyRequest): string {
  const raw = req.url.split('?')[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * App-weiter Guard (als preValidation-Hook, damit ohne Login nicht erst die Eingaben geprüft werden):
 * jede API-Route außer PUBLIC_API_PATHS verlangt eine gültige Session.
 */
export function requireAuthForApi(db: Db): preValidationHookHandler {
  return async (req) => {
    const path = apiPath(req);
    if (!path.startsWith('/api/') || PUBLIC_API_PATHS.has(path)) return;
    if (!getCurrentUser(db, req)) throw unauthorized();
  };
}

export function getRole(db: Db, groupId: number, userId: number): Role | null {
  const row = getRow<{ role: Role }>(db, 'SELECT role FROM memberships WHERE group_id = ? AND user_id = ?', groupId, userId);
  return row?.role ?? null;
}

export interface MemberContext {
  user: User;
  groupId: number;
  role: Role;
}

export function requireMember(db: Db, req: FastifyRequest): MemberContext {
  const user = requireUser(db, req);
  const groupId = (req.params as { gid: number }).gid;
  const role = getRole(db, groupId, user.id);
  if (!role) throw forbidden('Du bist kein Mitglied dieser Gruppe');
  return { user, groupId, role };
}

export function requireGm(db: Db, req: FastifyRequest): MemberContext {
  const ctx = requireMember(db, req);
  if (ctx.role !== 'gm') throw gmOnly();
  return ctx;
}

/** Für gruppenübergreifende Inhalte (Regelwerk): eingeloggt und Mitglied irgendeiner Gruppe */
export function requireAnyMember(db: Db, req: FastifyRequest): User {
  const user = requireUser(db, req);
  if (!getRow(db, 'SELECT 1 FROM memberships WHERE user_id = ? LIMIT 1', user.id)) throw forbidden('Nur für Mitglieder einer Gruppe');
  return user;
}

/** Der Bereich "Spielleiter" ist für Spieler komplett gesperrt. */
export function assertSection(ctx: MemberContext, section: Section): void {
  if (!canAccessSection(ctx.role, section)) throw gmOnly();
}
