import type { FastifyInstance } from 'fastify';
import {
  ASPECT_LABELS,
  CONSEQUENCES,
  MAX_SHEET_LINE_LENGTH,
  MAX_SKILL_VALUE,
  MAX_STUNTS_LENGTH,
  MIN_SKILL_VALUE,
  STRESS_BOXES,
  STRESS_LABELS,
  canHaveSheet,
  normalizeSheet,
  type Article,
  type Sheet,
  type SheetData,
} from '@pnp/shared';
import { getRow, parseJson, run, type Db } from '../db.ts';
import { requireMember, type MemberContext } from '../auth.ts';
import { loadVisibleArticle } from '../articles.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { listGroupSkills } from '../skills.ts';
import { idParams, objectOf } from '../schemas.ts';

const sheetParams = idParams('id');
const noSheet = () => notFound('Dieser Artikel hat keinen FATE-Bogen');
// Das Schema begrenzt nur Form und Längen; Steuerzeichen in einzeiligen Feldern (z.B. ein mitkopierter Tab)
// ersetzt normalizeSheet, statt das Autospeichern mit einer kryptischen Meldung scheitern zu lassen.
const text = (maxLength: number) => ({ type: 'string', maxLength });
const line = text(MAX_SHEET_LINE_LENGTH);
const fields = (keys: readonly string[], schema: object) => objectOf(Object.fromEntries(keys.map((key) => [key, schema])));
const stressTrack = { type: 'array', minItems: STRESS_BOXES, maxItems: STRESS_BOXES, items: { type: 'boolean' } };

const sheetData = objectOf({
  name: line,
  age: line,
  pronouns: line,
  aspects: fields(Object.keys(ASPECT_LABELS), line),
  stunts: text(MAX_STUNTS_LENGTH),
  refresh: line,
  stress: fields(Object.keys(STRESS_LABELS), stressTrack),
  consequences: fields(CONSEQUENCES.map((c) => c.key), line),
  skills: {
    type: 'object',
    additionalProperties: { type: 'integer', minimum: MIN_SKILL_VALUE, maximum: MAX_SKILL_VALUE },
  },
});

export function sheetRoutes(app: FastifyInstance, db: Db): void {
  const loadEditable = (ctx: MemberContext, id: number): Article => {
    const article = loadVisibleArticle(db, ctx, id);
    if (!article.canEdit) throw forbidden('Du darfst diesen Bogen nicht bearbeiten');
    return article;
  };

  const loadSheet = (articleId: number): Sheet | undefined => {
    const row = getRow<{ data: string; version: number }>(
      db,
      'SELECT data, version FROM character_sheets WHERE article_id = ?',
      articleId,
    );
    return row && { data: normalizeSheet(parseJson<unknown>(row.data, null)), version: row.version };
  };

  /** Bereinigt die Eingabe; Werte inzwischen gelöschter Fertigkeiten werden verworfen, statt das Speichern zu verweigern */
  const withKnownSkills = (groupId: number, input: SheetData): SheetData => {
    const data = normalizeSheet(input);
    const known = new Set(listGroupSkills(db, groupId).map((skill) => String(skill.id)));
    return { ...data, skills: Object.fromEntries(Object.entries(data.skills).filter(([id]) => known.has(id))) };
  };

  const route = '/api/groups/:gid/articles/:id/sheet';

  app.get(route, { schema: { params: sheetParams } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    loadVisibleArticle(db, ctx, id);
    const sheet = loadSheet(id);
    if (!sheet) throw noSheet();
    return sheet;
  });

  // Anlegen ist bewusst vom Speichern getrennt: Wer auf einer veralteten Seite "Bogen hinzufügen" klickt,
  // darf keinen inzwischen ausgefüllten Bogen leeren.
  app.post(route, { schema: { params: sheetParams, body: sheetData } }, (req, reply) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    const article = loadEditable(ctx, id);
    if (!canHaveSheet(article.section)) throw badRequest('Einen FATE-Bogen gibt es nur in Charaktere und Notizen');

    const data = withKnownSkills(ctx.groupId, req.body as SheetData);
    const created = run(
      db,
      'INSERT INTO character_sheets (article_id, data) VALUES (?, ?) ON CONFLICT (article_id) DO NOTHING',
      id,
      JSON.stringify(data),
    );
    if (!created) throw conflict('Dieser Artikel hat bereits einen FATE-Bogen - bitte die Seite neu laden');
    reply.code(201);
    return { data, version: 1 } satisfies Sheet;
  });

  app.put(route, { schema: { params: sheetParams, body: objectOf({ data: sheetData, version: { type: 'integer' } }) } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    loadEditable(ctx, id);

    const body = req.body as Sheet;
    const data = withKnownSkills(ctx.groupId, body.data);
    const updated = run(
      db,
      `UPDATE character_sheets SET data = ?, version = version + 1, updated_at = datetime('now')
       WHERE article_id = ? AND version = ?`,
      JSON.stringify(data),
      id,
      body.version,
    );
    if (!updated) {
      if (!loadSheet(id)) throw noSheet();
      throw conflict('Der Bogen wurde inzwischen von jemand anderem geändert');
    }
    return { data, version: body.version + 1 } satisfies Sheet;
  });

  app.delete(route, { schema: { params: sheetParams } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    loadEditable(ctx, id);
    run(db, 'DELETE FROM character_sheets WHERE article_id = ?', id);
    return { ok: true };
  });
}
