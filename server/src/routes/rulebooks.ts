import { createReadStream, existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { MAX_RULE_QUERY_LENGTH } from '@pnp/shared';
import type { Db } from '../db.ts';
import { requireAnyMember } from '../auth.ts';
import { notFound } from '../errors.ts';
import { getRulebook, listRulebooks, rulebookFile, searchRules } from '../rulebooks.ts';
import { intParams, objectOf } from '../schemas.ts';

const searchQuery = objectOf(
  { q: { type: 'string', maxLength: MAX_RULE_QUERY_LENGTH }, rulebookId: { type: 'integer' } },
  ['q'],
);

/** RFC 5987: encodeURIComponent lässt ' ( ) * ! stehen, die im filename*-Wert nicht erlaubt sind */
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Regelwerke gelten für alle Gruppen; lesen darf jedes Gruppenmitglied (nicht jeder, der sich mit irgendeiner
 * Adresse einloggt). Eingespielt werden sie per `npm run import-rulebook`.
 */
export function rulebookRoutes(app: FastifyInstance, db: Db, dir: string): void {
  app.get('/api/rulebooks', (req) => {
    requireAnyMember(db, req);
    return listRulebooks(db);
  });

  app.get('/api/rulebooks/search', { schema: { querystring: searchQuery } }, (req) => {
    requireAnyMember(db, req);
    const { q, rulebookId } = req.query as { q: string; rulebookId?: number };
    return searchRules(db, q, rulebookId);
  });

  app.get('/api/rulebooks/:id/pdf', { schema: { params: intParams('id') } }, (req, reply) => {
    requireAnyMember(db, req);
    const rulebook = getRulebook(db, (req.params as { id: number }).id);
    const file = rulebookFile(dir, rulebook.id);
    if (!existsSync(file)) throw notFound('Die PDF-Datei des Regelwerks fehlt');
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeRfc5987(`${rulebook.title}.pdf`)}`)
      // Die URL trägt den Importzeitpunkt (?v=…), ein neu eingespieltes PDF hat also eine neue Adresse
      .header('Cache-Control', 'private, max-age=86400')
      .send(createReadStream(file));
  });
}
