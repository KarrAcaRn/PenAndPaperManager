import type { FastifyInstance } from 'fastify';
import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  VISIBILITIES,
  canAccessSection,
  canHaveSheet,
  type ArticleInput,
  type ArticleSummary,
  type Section,
} from '@pnp/shared';
import { allRows, insertRow, run, type Db } from '../db.ts';
import { assertSection, getRole, requireMember, type MemberContext } from '../auth.ts';
import { VISIBLE_ARTICLE_SQL, visibilityParams } from '../access.ts';
import { SUMMARY_COLUMNS, loadVisibleArticle, toSummary } from '../articles.ts';
import { IN_SECTION_SQL, parsePath, sectionParams } from '../folders.ts';
import { badRequest, forbidden } from '../errors.ts';
import { gidParams, idParams, nonBlank, objectOf, sectionProp } from '../schemas.ts';

const articleParams = idParams('id');
const articleBody = objectOf(
  {
    section: sectionProp,
    path: { type: 'string', default: '' },
    title: nonBlank(MAX_TITLE_LENGTH),
    bodyMd: { type: 'string', maxLength: MAX_BODY_LENGTH, default: '' },
    visibility: { enum: VISIBILITIES },
  },
  ['section', 'title', 'visibility'],
);

export function articleRoutes(app: FastifyInstance, db: Db): void {
  const loadVisible = (ctx: MemberContext, id: number) => loadVisibleArticle(db, ctx, id);

  app.get(
    '/api/groups/:gid/articles',
    { schema: { params: gidParams, querystring: objectOf({ section: sectionProp, path: { type: 'string' } }, ['section']) } },
    (req) => {
      const ctx = requireMember(db, req);
      const { section, path } = req.query as { section: Section; path?: string };
      assertSection(ctx, section);
      const params: Record<string, string | number> = {
        ...sectionParams(ctx.groupId, section),
        ...visibilityParams(ctx.user.id, ctx.role),
      };
      // node:sqlite lehnt unbenutzte benannte Parameter ab, daher :path nur bei Bedarf
      if (path !== undefined) params.path = parsePath(path);
      const rows = allRows<ArticleSummary>(
        db,
        `SELECT ${SUMMARY_COLUMNS} FROM articles a JOIN users u ON u.id = a.author_id
         WHERE ${IN_SECTION_SQL} ${path === undefined ? '' : 'AND a.path = :path'}
           AND ${VISIBLE_ARTICLE_SQL}
         ORDER BY a.title COLLATE NOCASE`,
        params,
      );
      return rows.map(toSummary);
    },
  );

  app.post('/api/groups/:gid/articles', { schema: { params: gidParams, body: articleBody } }, (req, reply) => {
    const ctx = requireMember(db, req);
    const input = req.body as ArticleInput;
    assertSection(ctx, input.section);
    // Bewusst kein Eintrag in folders: Ordner, die nur aus Artikelpfaden entstehen, sieht nur,
    // wer auch einen Artikel darin sehen kann. So verraten private Artikel keine Ordnernamen.
    const id = insertRow(
      db,
      `INSERT INTO articles (group_id, section, path, title, body_md, visibility, author_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ctx.groupId,
      input.section,
      parsePath(input.path),
      input.title.trim(),
      input.bodyMd,
      input.visibility,
      ctx.user.id,
    );
    reply.code(201);
    return loadVisible(ctx, id);
  });

  app.get('/api/groups/:gid/articles/:id', { schema: { params: articleParams } }, (req) => {
    const ctx = requireMember(db, req);
    return loadVisible(ctx, (req.params as { id: number }).id);
  });

  app.put('/api/groups/:gid/articles/:id', { schema: { params: articleParams, body: articleBody } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    const input = req.body as ArticleInput;
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
    run(
      db,
      `UPDATE articles SET section = ?, path = ?, title = ?, body_md = ?, visibility = ?, updated_at = datetime('now')
       WHERE id = ?`,
      input.section,
      parsePath(input.path),
      input.title.trim(),
      input.bodyMd,
      input.visibility,
      id,
    );
    return loadVisible(ctx, id);
  });

  app.delete('/api/groups/:gid/articles/:id', { schema: { params: articleParams } }, (req) => {
    const ctx = requireMember(db, req);
    const { id } = req.params as { id: number };
    if (!loadVisible(ctx, id).canEdit) throw forbidden('Du darfst diesen Artikel nicht löschen');
    run(db, 'DELETE FROM articles WHERE id = ?', id);
    return { ok: true };
  });
}
