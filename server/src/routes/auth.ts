import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { destroySession, requireUser, toSessionUser, type AdminEmails } from '../auth.ts';

// Angemeldet wird per E-Mail-Code (routes/login-codes.ts); den früheren Login nur per E-Mail ohne Code gibt es nicht mehr.
export function authRoutes(app: FastifyInstance, db: Db, admins: AdminEmails): void {
  app.post('/api/auth/logout', (req, reply) => {
    destroySession(db, req, reply);
    return { ok: true };
  });

  // Nicht eingeloggt (kein, unbekanntes oder abgelaufenes Cookie): 401
  app.get('/api/auth/me', (req) => ({ user: toSessionUser(requireUser(db, req), admins) }));
}
