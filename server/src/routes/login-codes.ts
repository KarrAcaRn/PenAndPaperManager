import type { FastifyInstance } from 'fastify';
import { LOGIN_CODE_LENGTH } from '@pnp/shared';
import type { Db } from '../db.ts';
import { createSession, findOrCreateUser, toSessionUser, type AdminEmails } from '../auth.ts';
import { serviceUnavailable, unauthorized } from '../errors.ts';
import { consumeLoginCode, issueLoginCode, normalizeEmail, type LoginRateLimits, type SendLoginCodeEmail } from '../login-codes.ts';
import { emailBody, objectOf } from '../schemas.ts';

const INVALID_CODE = 'Code ungültig oder abgelaufen';

export interface LoginCodeOptions {
  sendLoginCodeEmail: SendLoginCodeEmail;
  rateLimits: LoginRateLimits;
}

export function loginCodeRoutes(app: FastifyInstance, db: Db, admins: AdminEmails, opts: LoginCodeOptions): void {
  // Antwortet für jede Adresse gleich (204), damit sich nicht herausfinden lässt, welche Adressen es gibt.
  app.post('/api/auth/request-code', { schema: { body: emailBody } }, async (req, reply) => {
    const { email } = req.body as { email: string };
    const code = issueLoginCode(db, email, req.ip, opts.rateLimits);
    try {
      await opts.sendLoginCodeEmail(normalizeEmail(email), code);
    } catch (err) {
      // Der Versand hängt nicht davon ab, ob es die Adresse gibt – die Meldung verrät also nichts.
      req.log.error(err, 'Login-Code konnte nicht verschickt werden');
      throw serviceUnavailable('Die E-Mail mit dem Code konnte nicht verschickt werden. Bitte versuche es später erneut.');
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
