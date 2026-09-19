import type { FastifyInstance } from 'fastify';
import { DEFAULT_FOLDERS, MAX_GROUP_NAME_LENGTH, type Group } from '@pnp/shared';
import { allRows, insertRow, run, transaction, type Db } from '../db.ts';
import { loadPreset } from '../presets.ts';
import { applySkillNames } from '../skills.ts';
import { requireUser } from '../auth.ts';
import { nonBlank, objectOf } from '../schemas.ts';

export function groupRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/groups', (req) => {
    const user = requireUser(db, req);
    return allRows<Group>(
      db,
      `SELECT g.id, g.name, m.role FROM groups g JOIN memberships m ON m.group_id = g.id
       WHERE m.user_id = ? ORDER BY g.name COLLATE NOCASE`,
      user.id,
    );
  });

  const groupBody = objectOf({ name: nonBlank(MAX_GROUP_NAME_LENGTH), presetId: { type: 'integer' } }, ['name']);

  app.post('/api/groups', { schema: { body: groupBody } }, (req, reply) => {
    const user = requireUser(db, req);
    const { name: rawName, presetId } = req.body as { name: string; presetId?: number };
    const name = rawName.trim();
    const group = transaction(db, (): Group => {
      const id = insertRow(db, 'INSERT INTO groups (name) VALUES (?)', name);
      // Wer eine Gruppe aufmacht, ist ihr Spielleiter.
      run(db, `INSERT INTO memberships (group_id, user_id, role) VALUES (?, ?, 'gm')`, id, user.id);
      for (const [section, paths] of Object.entries(DEFAULT_FOLDERS)) {
        for (const path of paths) {
          run(db, 'INSERT INTO folders (group_id, section, path, created_by) VALUES (?, ?, ?, ?)', id, section, path, user.id);
        }
      }
      // Optional gleich mit den Fertigkeiten einer Variante starten
      if (presetId !== undefined) applySkillNames(db, id, loadPreset(db, presetId).skills);
      return { id, name, role: 'gm' };
    });
    reply.code(201);
    return group;
  });
}
