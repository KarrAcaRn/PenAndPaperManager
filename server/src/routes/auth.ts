import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { destroySession, login, requireUser, toSessionUser, type AdminEmails } from '../auth.ts';
import { emailBody } from '../schemas.ts';

export function authRoutes(app: FastifyInstance, db: Db, admins: AdminEmails): void {
  app.post('/api/auth/login', { schema: { body: emailBody } }, (req, reply) =>
    toSessionUser(login(db, reply, (req.body as { email: string }).email), admins),
  );

  app.post('/api/auth/logout', (req, reply) => {
    destroySession(db, req, reply);
    return { ok: true };
  });

  // Nicht eingeloggt (kein, unbekanntes oder abgelaufenes Cookie): 401
  app.get('/api/auth/me', (req) => ({ user: toSessionUser(requireUser(db, req), admins) }));
}
