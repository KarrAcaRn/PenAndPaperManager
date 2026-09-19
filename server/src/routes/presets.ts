import type { FastifyInstance } from 'fastify';
import { MAX_PRESET_DESCRIPTION_LENGTH, MAX_PRESET_NAME_LENGTH, type SkillPresetInput } from '@pnp/shared';
import type { Db } from '../db.ts';
import { requireAdmin, requireUser, type AdminEmails } from '../auth.ts';
import { deletePreset, insertPreset, listPresets, updatePreset } from '../presets.ts';
import { parseSkillNames } from '../skills.ts';
import { intParams, nonBlank, objectOf, skillNames } from '../schemas.ts';

const presetParams = intParams('id');
const presetBody = objectOf(
  {
    name: nonBlank(MAX_PRESET_NAME_LENGTH),
    description: { type: 'string', maxLength: MAX_PRESET_DESCRIPTION_LENGTH, default: '' },
    skills: { ...skillNames, minItems: 1 },
  },
  ['name', 'skills'],
);

export function presetRoutes(app: FastifyInstance, db: Db, admins: AdminEmails): void {
  const parse = (body: unknown): SkillPresetInput => {
    const input = body as SkillPresetInput;
    return { name: input.name.trim(), description: input.description.trim(), skills: parseSkillNames(input.skills) };
  };

  // Lesen darf jeder Eingeloggte: Spielleiter wählen daraus ihre Fertigkeiten.
  app.get('/api/presets', (req) => {
    requireUser(db, req);
    return listPresets(db);
  });

  app.post('/api/presets', { schema: { body: presetBody } }, (req, reply) => {
    requireAdmin(db, req, admins);
    reply.code(201);
    return insertPreset(db, parse(req.body));
  });

  app.put('/api/presets/:id', { schema: { params: presetParams, body: presetBody } }, (req) => {
    requireAdmin(db, req, admins);
    return updatePreset(db, (req.params as { id: number }).id, parse(req.body));
  });

  app.delete('/api/presets/:id', { schema: { params: presetParams } }, (req) => {
    requireAdmin(db, req, admins);
    deletePreset(db, (req.params as { id: number }).id);
    return { ok: true };
  });
}
