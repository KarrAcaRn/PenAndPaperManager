import type { FastifyInstance, FastifyReply } from 'fastify';
import { LOGIN_CODE_LENGTH, type User } from '@pnp/shared';
import { getRow, type Db } from '../db.ts';
import { findOrCreateUser, login, toSessionUser, type AdminEmails } from '../auth.ts';
import { unauthorized } from '../errors.ts';
import { consumeLoginCode, issueLoginCode, normalizeEmail, type SendLoginCodeEmail } from '../login-codes.ts';
import { emailBody, objectOf } from '../schemas.ts';

/**
 * Stub für createSession(userId, reply) aus dem Session-Task: bis dahin erzeugt der bisherige login() die Session
 * samt Cookie.
 */
function createSession(db: Db, userId: number, reply: FastifyReply): void {
  const user = getRow<User>(db, 'SELECT id, email FROM users WHERE id = ?', userId)!;
  login(db, reply, user.email);
}

const INVALID_CODE = 'Code ungültig oder abgelaufen';

export function loginCodeRoutes(app: FastifyInstance, db: Db, admins: AdminEmails, sendLoginCodeEmail: SendLoginCodeEmail): void {
  // Antwortet für jede Adresse gleich (204), damit sich nicht herausfinden lässt, welche Adressen es gibt.
  app.post('/api/auth/request-code', { schema: { body: emailBody } }, async (req, reply) => {
    const { email } = req.body as { email: string };
    const code = issueLoginCode(db, email, req.ip);
    try {
      await sendLoginCodeEmail(normalizeEmail(email), code);
    } catch (err) {
      req.log.error(err, 'Login-Code konnte nicht verschickt werden');
    }
    return reply.code(204).send();
  });

  app.post(
    '/api/auth/verify-code',
    {
      schema: {
        body: objectOf({
          email: emailBody.properties.email,
          // grob begrenzt; falsches Format zählt wie ein falscher Code als Fehlversuch
          code: { type: 'string', maxLength: LOGIN_CODE_LENGTH * 2 },
        }),
      },
    },
    (req, reply) => {
      const { email, code } = req.body as { email: string; code: string };
      if (!consumeLoginCode(db, email, code)) throw unauthorized(INVALID_CODE);
      const user = findOrCreateUser(db, email);
      createSession(db, user.id, reply);
      return { user: toSessionUser(user, admins) };
    },
  );
}
