import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { currentUser, login, logout, toSessionUser, type AdminEmails } from '../auth.ts';
import { emailBody } from '../schemas.ts';

export function authRoutes(app: FastifyInstance, db: Db, admins: AdminEmails): void {
  app.post('/api/auth/login', { schema: { body: emailBody } }, (req, reply) =>
    toSessionUser(login(db, reply, (req.body as { email: string }).email), admins),
  );

  app.post('/api/auth/logout', (req, reply) => {
    logout(db, req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', (req) => {
    const user = currentUser(db, req);
    return { user: user && toSessionUser(user, admins) };
  });
}
