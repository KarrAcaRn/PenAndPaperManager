import type { FastifyInstance } from 'fastify';
import {
  ASPECT_LABELS,
  CONSEQUENCE_VALUES,
  MAX_CONSEQUENCES,
  MAX_CONSEQUENCE_KEY_LENGTH,
  MAX_SHEET_LINE_LENGTH,
  MAX_SKILL_VALUE,
  MAX_STUNTS_LENGTH,
  MIN_SKILL_VALUE,
  MIN_STRESS_BOXES,
  STRESS_BOXES,
  STRESS_LABELS,
  canHaveSheet,
  emptySheetState,
  normalizeSheet,
  normalizeSheetState,
  type Article,
  type Sheet,
  type SheetData,
  type SheetState,
} from '@pnp/shared';
import { getRow, parseJson, run, type Db } from '../db.ts';
import { requireMember, type MemberContext } from '../auth.ts';
import { loadVisibleArticle } from '../articles.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { listGroupSkills } from '../skills.ts';
import { idParams, objectOf } from '../schemas.ts';

/** Aufbau von data/state in character_sheets.format; ändert er sich, hier ältere Formate beim Lesen umwandeln */
const SHEET_FORMAT = 1;

const sheetParams = idParams('id');
const noSheet = () => notFound('Dieser Artikel hat keinen FATE-Bogen');
// Das Schema begrenzt nur Form und Längen; Steuerzeichen in einzeiligen Feldern (z.B. ein mitkopierter Tab)
// ersetzt normalizeSheet, statt das Speichern mit einer kryptischen Meldung scheitern zu lassen.
const text = (maxLength: number) => ({ type: 'string', maxLength });
const line = text(MAX_SHEET_LINE_LENGTH);
const fields = (keys: readonly string[], schema: object) => objectOf(Object.fromEntries(keys.map((key) => [key, schema])));
const consequenceKey = { type: 'string', minLength: 1, maxLength: MAX_CONSEQUENCE_KEY_LENGTH };

const sheetData = objectOf({
  name: line,
  age: line,
  pronouns: line,
  aspects: fields(Object.keys(ASPECT_LABELS), line),
  stunts: text(MAX_STUNTS_LENGTH),
  refresh: line,
  stressBoxes: fields(Object.keys(STRESS_LABELS), { type: 'integer', minimum: MIN_STRESS_BOXES, maximum: STRESS_BOXES }),
  consequences: {
    type: 'array',
    maxItems: MAX_CONSEQUENCES,
    items: objectOf({ key: consequenceKey, value: { enum: CONSEQUENCE_VALUES } }),
  },
  skills: {
    type: 'object',
    additionalProperties: { type: 'integer', minimum: MIN_SKILL_VALUE, maximum: MAX_SKILL_VALUE },
  },
});

const sheetState = objectOf({
  stress: fields(Object.keys(STRESS_LABELS), { type: 'array', minItems: STRESS_BOXES, maxItems: STRESS_BOXES, items: { type: 'boolean' } }),
  consequences: {
    type: 'object',
    maxProperties: MAX_CONSEQUENCES,
    propertyNames: consequenceKey,
    additionalProperties: line,
  },
});

interface SheetRow {
  data: string;
  version: number;
  state: string;
  stateVersion: number;
}

export function sheetRoutes(app: FastifyInstance, db: Db): void {
  const loadEditable = (ctx: MemberContext, id: number): Article => {
    const article = loadVisibleArticle(db, ctx, id);
    if (!article.canEdit) throw forbidden('Du darfst diesen Bogen nicht bearbeiten');
    return article;
  };

  const loadSheet = (articleId: number): Sheet | undefined => {
    const row = getRow<SheetRow>(
      db,
      'SELECT data, version, state, state_version AS stateVersion FROM character_sheets WHERE article_id = ?',
      articleId,
    );
    if (!row) return undefined;
    const data = normalizeSheet(parseJson<unknown>(row.data, null));
    // Texte zu inzwischen entfernten Konsequenzzeilen fallen weg
    const state = normalizeSheetState(parseJson<unknown>(row.state, null), data);
    return { data, version: row.version, state, stateVersion: row.stateVersion };
  };

  /** Bereinigt die Eingabe; Werte inzwischen gelöschter Fertigkeiten werden verworfen, statt das Speichern zu verweigern */
  const withKnownSkills = (groupId: number, input: SheetData): SheetData => {
    const data = normalizeSheet(input);
    const known = new Set(listGroupSkills(db, groupId).map((skill) => String(skill.id)));
    return { ...data, skills: Object.fromEntries(Object.entries(data.skills).filter(([id]) => known.has(id))) };
  };

  const changedElsewhere = (id: number) => {
    if (!getRow(db, 'SELECT 1 FROM character_sheets WHERE article_id = ?', id)) return noSheet();
    return conflict('Der Bogen wurde inzwischen von jemand anderem geändert');
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
  app.post(
    route,
    { schema: { params: sheetParams, body: objectOf({ data: sheetData, state: sheetState }, ['data']) } },
    (req, reply) => {
      const ctx = requireMember(db, req);
      const { id } = req.params as { id: number };
      const article = loadEditable(ctx, id);
      if (!canHaveSheet(article.section)) throw badRequest('Einen FATE-Bogen gibt es nur in Charaktere und Notizen');

      const body = req.body as { data: SheetData; state?: SheetState };
      const data = withKnownSkills(ctx.groupId, body.data);
      const state = body.state ? normalizeSheetState(body.state, data) : emptySheetState();
      const created = run(
        db,
        `INSERT INTO character_sheets (article_id, format, data, state) VALUES (?, ?, ?, ?)
         ON CONFLICT (article_id) DO NOTHING`,
        id,
        SHEET_FORMAT,
        JSON.stringify(data),
        JSON.stringify(state),
      );
      if (!created) throw conflict('Dieser Artikel hat bereits einen FATE-Bogen - bitte die Seite neu laden');
      reply.code(201);
      return { data, version: 1, state, stateVersion: 1 } satisfies Sheet;
    },
  );

  // Bogen speichern (Bearbeiten-Modus); der Zustand bleibt unberührt
  app.put(route, { schema: { params: sheetParams, body: objectOf({ data: sheetData, version: { type: 'integer' } }) } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    loadEditable(ctx, id);
    const body = req.body as { data: SheetData; version: number };
    const data = withKnownSkills(ctx.groupId, body.data);
    const updated = run(
      db,
      `UPDATE character_sheets SET data = ?, format = ?, version = version + 1, updated_at = datetime('now')
       WHERE article_id = ? AND version = ?`,
      JSON.stringify(data),
      SHEET_FORMAT,
      id,
      body.version,
    );
    if (!updated) throw changedElsewhere(id);
    return { data, version: body.version + 1 };
  });

  // Zustand speichern (Stress, Konsequenztexte) - auch aus der Artikelansicht, sofort beim Eingeben
  app.put(
    `${route}/state`,
    { schema: { params: sheetParams, body: objectOf({ state: sheetState, stateVersion: { type: 'integer' } }) } },
    (req) => {
      const ctx = requireMember(db, req);
      const { id } = req.params as { id: number };
      loadEditable(ctx, id);
      const body = req.body as { state: SheetState; stateVersion: number };
      const sheet = loadSheet(id);
      if (!sheet) throw noSheet();
      // Texte zu Zeilen, die es auf dem Bogen nicht (mehr) gibt, gar nicht erst speichern
      const state = normalizeSheetState(body.state, sheet.data);
      const updated = run(
        db,
        `UPDATE character_sheets SET state = ?, state_version = state_version + 1, updated_at = datetime('now')
         WHERE article_id = ? AND state_version = ?`,
        JSON.stringify(state),
        id,
        body.stateVersion,
      );
      if (!updated) throw changedElsewhere(id);
      return { state, stateVersion: body.stateVersion + 1 };
    },
  );

  app.delete(route, { schema: { params: sheetParams } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    loadEditable(ctx, id);
    run(db, 'DELETE FROM character_sheets WHERE article_id = ?', id);
    return { ok: true };
  });
}
