import type { FastifyInstance } from 'fastify';
import type { Skill, SkillInput } from '@pnp/shared';
import { transaction, type Db } from '../db.ts';
import { requireGm, requireMember } from '../auth.ts';
import { loadUsablePreset } from '../presets.ts';
import { applySkillNames, assertSkillsUnchanged, listGroupSkills, replaceGroupSkills } from '../skills.ts';
import { gidParams, objectOf, skillList, skillName } from '../schemas.ts';

/** Stand der Liste, von dem der Client ausgeht (optional) - weicht der aktuelle ab, gibt es 409 */
const expected = skillList(objectOf({ id: { type: 'integer' }, name: { type: 'string' } }));

const skillsBody = objectOf(
  { skills: skillList(objectOf({ id: { type: 'integer' }, name: skillName }, ['name'])), expected },
  ['skills'],
);
const presetBody = objectOf({ presetId: { type: 'integer' }, expected }, ['presetId']);

export function skillRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/groups/:gid/skills', { schema: { params: gidParams } }, (req) => {
    const { groupId } = requireMember(db, req);
    return listGroupSkills(db, groupId);
  });

  app.put('/api/groups/:gid/skills', { schema: { params: gidParams, body: skillsBody } }, (req) => {
    const { groupId } = requireGm(db, req);
    const body = req.body as { skills: SkillInput[]; expected?: Skill[] };
    return transaction(db, () => {
      assertSkillsUnchanged(db, groupId, body.expected);
      return replaceGroupSkills(db, groupId, body.skills);
    });
  });

  app.post(
    '/api/groups/:gid/skills/from-preset',
    { schema: { params: gidParams, body: presetBody } },
    (req) => {
      const { groupId } = requireGm(db, req);
      const body = req.body as { presetId: number; expected?: Skill[] };
      return transaction(db, () => {
        assertSkillsUnchanged(db, groupId, body.expected);
        return applySkillNames(db, groupId, loadUsablePreset(db, body.presetId).skills);
      });
    },
  );
}
