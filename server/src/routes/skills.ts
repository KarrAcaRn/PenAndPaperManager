import type { FastifyInstance } from 'fastify';
import type { SkillInput } from '@pnp/shared';
import { transaction, type Db } from '../db.ts';
import { requireGm, requireMember } from '../auth.ts';
import { loadPreset } from '../presets.ts';
import { applySkillNames, listGroupSkills, replaceGroupSkills } from '../skills.ts';
import { gidParams, objectOf, skillList, skillName } from '../schemas.ts';

const skillsBody = objectOf({
  skills: skillList(objectOf({ id: { type: 'integer' }, name: skillName }, ['name'])),
});

export function skillRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/groups/:gid/skills', { schema: { params: gidParams } }, (req) => {
    const { groupId } = requireMember(db, req);
    return listGroupSkills(db, groupId);
  });

  app.put('/api/groups/:gid/skills', { schema: { params: gidParams, body: skillsBody } }, (req) => {
    const { groupId } = requireGm(db, req);
    const { skills } = req.body as { skills: SkillInput[] };
    return transaction(db, () => replaceGroupSkills(db, groupId, skills));
  });

  app.post(
    '/api/groups/:gid/skills/from-preset',
    { schema: { params: gidParams, body: objectOf({ presetId: { type: 'integer' } }) } },
    (req) => {
      const { groupId } = requireGm(db, req);
      const { presetId } = req.body as { presetId: number };
      return transaction(db, () => applySkillNames(db, groupId, loadPreset(db, presetId).skills));
    },
  );
}
