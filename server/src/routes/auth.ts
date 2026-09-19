import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.ts';
import { currentUser, login, logout } from '../auth.ts';
import { emailBody } from '../schemas.ts';

export function authRoutes(app: FastifyInstance, db: Db): void {
  app.post('/api/auth/login', { schema: { body: emailBody } }, (req, reply) =>
    login(db, reply, (req.body as { email: string }).email),
  );

  app.post('/api/auth/logout', (req, reply) => {
    logout(db, req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', (req) => ({ user: currentUser(db, req) }));
}
