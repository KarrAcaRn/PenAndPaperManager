import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { canAccessSection, type Role, type Section, type SessionUser, type User } from '@pnp/shared';
import { getRow, run, type Db } from './db.ts';
import { adminOnly, forbidden, gmOnly, unauthorized } from './errors.ts';

export const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

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

/**
 * Testphase: Login nur per E-Mail, ohne Passwort.
 * Passwort bzw. Einmal-Codes per E-Mail werden später hier ergänzt.
 */
export function login(db: Db, reply: FastifyReply, email: string): User {
  const user = findOrCreateUser(db, email);
  const token = randomBytes(32).toString('hex');
  run(
    db,
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`,
    token,
    user.id,
    `+${SESSION_DAYS} days`,
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return user;
}

export function logout(db: Db, req: FastifyRequest, reply: FastifyReply): void {
  const token = req.cookies[SESSION_COOKIE];
  if (token) run(db, 'DELETE FROM sessions WHERE token = ?', token);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function currentUser(db: Db, req: FastifyRequest): User | null {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const user = getRow<User>(
    db,
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`,
    token,
  );
  return user ?? null;
}

export function requireUser(db: Db, req: FastifyRequest): User {
  const user = currentUser(db, req);
  if (!user) throw unauthorized();
  return user;
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

/** Der Bereich "Spielleiter" ist für Spieler komplett gesperrt. */
export function assertSection(ctx: MemberContext, section: Section): void {
  if (!canAccessSection(ctx.role, section)) throw gmOnly();
}
