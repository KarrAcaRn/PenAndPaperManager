import type { FastifyInstance } from 'fastify';
import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  VISIBILITIES,
  canAccessSection,
  canHaveSheet,
  type ArticleInput,
  type ArticleUpdate,
  type Section,
} from '@pnp/shared';
import { allRows, getRow, insertRow, run, transaction, type Db } from '../db.ts';
import { assertSection, getRole, requireMember, type MemberContext } from '../auth.ts';
import { VISIBLE_ARTICLE_SQL, visibilityParams } from '../access.ts';
import { ARTICLES_FROM, SUMMARY_COLUMNS, loadVisibleArticle, toSummary, type SummaryRow } from '../articles.ts';
import { IN_SECTION_SQL, ensureFolderPath, findFolderId, folderPathLookup, parsePath, sectionParams } from '../folders.ts';
import { badRequest, forbidden } from '../errors.ts';
import { gidParams, idParams, nonBlank, objectOf, sectionProp } from '../schemas.ts';

const articleParams = idParams('id');
const articleFields = {
  section: sectionProp,
  title: nonBlank(MAX_TITLE_LENGTH),
  bodyMd: { type: 'string', maxLength: MAX_BODY_LENGTH, default: '' },
  visibility: { enum: VISIBILITIES },
};
const required = ['section', 'title', 'visibility'];
const articleBody = objectOf({ ...articleFields, path: { type: 'string', default: '' } }, required);
// Beim Ändern ohne Vorgabe: fehlt path, bleibt der Artikel in seinem Ordner (siehe ArticleUpdate)
const articleUpdateBody = objectOf({ ...articleFields, path: { type: 'string' } }, required);

export function articleRoutes(app: FastifyInstance, db: Db): void {
  const loadVisible = (ctx: MemberContext, id: number) => loadVisibleArticle(db, ctx, id);

  app.get(
    '/api/groups/:gid/articles',
    { schema: { params: gidParams, querystring: objectOf({ section: sectionProp, path: { type: 'string' } }, ['section']) } },
    (req) => {
      const ctx = requireMember(db, req);
      const { section, path } = req.query as { section: Section; path?: string };
      assertSection(ctx, section);
      const params: Record<string, string | number | null> = {
        ...sectionParams(ctx.groupId, section),
        ...visibilityParams(ctx.user.id, ctx.role),
      };
      // node:sqlite lehnt unbenutzte benannte Parameter ab, daher :folderId nur bei Bedarf
      if (path !== undefined) {
        const folderId = findFolderId(db, ctx.groupId, section, parsePath(path));
        if (folderId === undefined) return [];
        params.folderId = folderId;
      }
      const rows = allRows<SummaryRow>(
        db,
        `SELECT ${SUMMARY_COLUMNS} FROM ${ARTICLES_FROM}
         WHERE ${IN_SECTION_SQL} ${path === undefined ? '' : 'AND a.folder_id IS :folderId'}
           AND ${VISIBLE_ARTICLE_SQL}
         ORDER BY a.title COLLATE NOCASE`,
        params,
      );
      const pathOf = folderPathLookup(db, ctx.groupId, section);
      return rows.map((row) => toSummary(row, pathOf, ctx));
    },
  );

  app.post('/api/groups/:gid/articles', { schema: { params: gidParams, body: articleBody } }, (req, reply) => {
    const ctx = requireMember(db, req);
    const input = req.body as ArticleInput;
    assertSection(ctx, input.section);
    const path = parsePath(input.path);
    // Ein neu eingetippter Ordner wird angelegt (sichtbar für alle im Bereich, wie jeder Ordner)
    const id = transaction(db, () =>
      insertRow(
        db,
        `INSERT INTO articles (group_id, section, folder_id, title, body_md, visibility, author_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ctx.groupId,
        input.section,
        ensureFolderPath(db, ctx.groupId, input.section, path, ctx.user.id),
        input.title.trim(),
        input.bodyMd,
        input.visibility,
        ctx.user.id,
      ),
    );
    reply.code(201);
    return loadVisible(ctx, id);
  });

  app.get('/api/groups/:gid/articles/:id', { schema: { params: articleParams } }, (req) => {
    const ctx = requireMember(db, req);
    return loadVisible(ctx, (req.params as { id: number }).id);
  });

  app.put('/api/groups/:gid/articles/:id', { schema: { params: articleParams, body: articleUpdateBody } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    const input = req.body as ArticleUpdate;
    const existing = loadVisible(ctx, id);
    if (!existing.canEdit) throw forbidden('Du darfst diesen Artikel nicht bearbeiten');
    assertSection(ctx, input.section);
    if (existing.authorId !== ctx.user.id) {
      // Sonst würde sich ein Spielleiter selbst aus einem fremden Artikel aussperren ...
      if (input.visibility === 'private') throw forbidden('Nur der Autor kann einen Artikel auf "Privat" stellen');
      // ... oder den Autor aus dessen eigenem Artikel. (Nur beim Verschieben: liegt der Artikel eines
      // degradierten Spielleiters schon im SL-Bereich, muss er bearbeitbar bleiben.)
      const authorRole = getRole(db, ctx.groupId, existing.authorId);
      if (input.section !== existing.section && authorRole && !canAccessSection(authorRole, input.section)) {
        throw forbidden('Der Autor hätte in diesem Bereich keinen Zugriff mehr auf seinen Artikel');
      }
    }
    if (existing.hasSheet && !canHaveSheet(input.section)) {
      throw badRequest('Artikel mit FATE-Bogen können nur in Charaktere oder Notizen liegen - entferne erst den Bogen');
    }
    if (input.path === undefined && input.section !== existing.section) {
      throw badRequest('Beim Verschieben in einen anderen Bereich fehlt der Ordner');
    }
    const path = input.path === undefined ? undefined : parsePath(input.path);
    transaction(db, () =>
      run(
        db,
        `UPDATE articles SET section = ?, folder_id = ?, title = ?, body_md = ?, visibility = ?, updated_at = datetime('now')
         WHERE id = ?`,
        input.section,
        path === undefined
          ? getRow<{ folderId: number | null }>(db, 'SELECT folder_id AS folderId FROM articles WHERE id = ?', id)!.folderId
          : ensureFolderPath(db, ctx.groupId, input.section, path, ctx.user.id),
        input.title.trim(),
        input.bodyMd,
        input.visibility,
        id,
      ),
    );
    return loadVisible(ctx, id);
  });

  // Verschieben in einen anderen Ordner desselben Bereichs (Drag & Drop im Ordnerbaum). Ändert sonst nichts, auch
  // nicht "zuletzt geändert" - wie beim Umbenennen eines Ordners ist das Ordnen keine Änderung am Inhalt.
  app.patch(
    '/api/groups/:gid/articles/:id',
    { schema: { params: articleParams, body: objectOf({ path: { type: 'string' } }) } },
    (req) => {
      const ctx = requireMember(db, req);
      const { id } = req.params as { id: number };
      const existing = loadVisible(ctx, id);
      if (!existing.canEdit) throw forbidden('Du darfst diesen Artikel nicht verschieben');
      const path = parsePath((req.body as { path: string }).path);
      transaction(db, () =>
        run(
          db,
          'UPDATE articles SET folder_id = ? WHERE id = ?',
          ensureFolderPath(db, ctx.groupId, existing.section, path, ctx.user.id),
          id,
        ),
      );
      return loadVisible(ctx, id);
    },
  );

  app.delete('/api/groups/:gid/articles/:id', { schema: { params: articleParams } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    if (!loadVisible(ctx, id).canEdit) throw forbidden('Du darfst diesen Artikel nicht löschen');
    run(db, 'DELETE FROM articles WHERE id = ?', id);
    return { ok: true };
  });
}
