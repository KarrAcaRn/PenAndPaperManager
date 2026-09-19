import type { FastifyInstance } from 'fastify';
import { ROLES, type Member, type Role } from '@pnp/shared';
import { allRows, getRow, run, transaction, type Db } from '../db.ts';
import { findOrCreateUser, getRole, requireGm, requireMember } from '../auth.ts';
import { conflict, gmOnly, notFound } from '../errors.ts';
import { emailBody, gidParams, idParams, objectOf } from '../schemas.ts';

const memberParams = idParams('uid');

export function memberRoutes(app: FastifyInstance, db: Db): void {
  const gmCount = (groupId: number) =>
    getRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM memberships WHERE group_id = ? AND role = 'gm'`, groupId)!.n;

  const requireTargetRole = (groupId: number, userId: number): Role => {
    const role = getRole(db, groupId, userId);
    if (!role) throw notFound('Mitglied nicht gefunden');
    return role;
  };

  /** Es muss immer mindestens einen Spielleiter geben. */
  const assertNotLastGm = (groupId: number, userId: number) => {
    if (requireTargetRole(groupId, userId) === 'gm' && gmCount(groupId) <= 1) {
      throw conflict('Die Gruppe braucht mindestens einen Spielleiter');
    }
  };

  /**
   * Private Artikel, an die ihr Autor nicht mehr herankommt, könnte sonst niemand mehr sehen oder löschen
   * (und ihre Ordner wären nie wieder leer). Sie gehen deshalb an die Spielleiter über.
   */
  const releasePrivateArticles = (groupId: number, authorId: number, extraCondition = '') =>
    run(
      db,
      `UPDATE articles SET visibility = 'private_gm'
       WHERE group_id = ? AND author_id = ? AND visibility = 'private' ${extraCondition}`,
      groupId,
      authorId,
    );

  app.get('/api/groups/:gid/members', { schema: { params: gidParams } }, (req) => {
    const { groupId } = requireMember(db, req);
    return allRows<Member>(
      db,
      `SELECT u.id AS userId, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ? ORDER BY m.role, u.email`,
      groupId,
    );
  });

  app.post('/api/groups/:gid/members', { schema: { params: gidParams, body: emailBody } }, (req, reply) => {
    const { groupId } = requireGm(db, req);
    const member = transaction(db, (): Member => {
      // Unbekannte Logins werden angelegt, damit sie die Gruppe beim ersten Login sehen.
      const invited = findOrCreateUser(db, (req.body as { email: string }).email);
      if (getRole(db, groupId, invited.id)) throw conflict('Ist bereits Mitglied der Gruppe');
      run(db, `INSERT INTO memberships (group_id, user_id, role) VALUES (?, ?, 'player')`, groupId, invited.id);
      return { userId: invited.id, email: invited.email, role: 'player' };
    });
    reply.code(201);
    return member;
  });

  app.patch(
    '/api/groups/:gid/members/:uid',
    { schema: { params: memberParams, body: objectOf({ role: { enum: ROLES } }) } },
    (req) => {
      const { groupId } = requireGm(db, req);
      const { uid } = req.params as { uid: number };
      const { role } = req.body as { role: Role };
      transaction(db, () => {
        if (role === 'player') {
          assertNotLastGm(groupId, uid);
          releasePrivateArticles(groupId, uid, `AND section = 'gm'`);
        } else {
          requireTargetRole(groupId, uid);
        }
        run(db, 'UPDATE memberships SET role = ? WHERE group_id = ? AND user_id = ?', role, groupId, uid);
      });
      return { ok: true };
    },
  );

  app.delete('/api/groups/:gid/members/:uid', { schema: { params: memberParams } }, (req) => {
    const { user, groupId, role } = requireMember(db, req);
    const { uid } = req.params as { uid: number };
    if (role !== 'gm' && uid !== user.id) throw gmOnly();
    transaction(db, () => {
      assertNotLastGm(groupId, uid);
      releasePrivateArticles(groupId, uid);
      run(db, 'DELETE FROM memberships WHERE group_id = ? AND user_id = ?', groupId, uid);
    });
    return { ok: true };
  });
}
