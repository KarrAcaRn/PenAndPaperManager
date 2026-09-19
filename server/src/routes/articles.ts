import type { FastifyInstance } from 'fastify';
import {
  MAX_TITLE_LENGTH,
  VISIBILITIES,
  canAccessSection,
  type Article,
  type ArticleInput,
  type ArticleSummary,
  type Section,
} from '@pnp/shared';
import { allRows, getRow, insertRow, run, type Db } from '../db.ts';
import { assertSection, getRole, requireMember, type MemberContext } from '../auth.ts';
import { VISIBLE_ARTICLE_SQL, canEditArticle, canSeeArticle, visibilityParams } from '../access.ts';
import { parsePath } from '../folders.ts';
import { forbidden, notFound } from '../errors.ts';
import { gidParams, idParams, nonBlank, objectOf, sectionProp } from '../schemas.ts';

const articleParams = idParams('id');
const articleBody = objectOf(
  {
    section: sectionProp,
    path: { type: 'string', default: '' },
    title: nonBlank(MAX_TITLE_LENGTH),
    bodyMd: { type: 'string', maxLength: 200_000, default: '' },
    visibility: { enum: VISIBILITIES },
  },
  ['section', 'title', 'visibility'],
);

const SUMMARY_COLUMNS = `a.id, a.section, a.path, a.title, a.visibility, a.author_id AS authorId,
  u.email AS authorEmail, a.updated_at AS updatedAt`;

export function articleRoutes(app: FastifyInstance, db: Db): void {
  /** Liefert den Artikel nur, wenn der Anfragende ihn sehen darf - sonst 404. */
  const loadVisible = (ctx: MemberContext, id: number): Article => {
    const row = getRow<Omit<Article, 'canEdit'>>(
      db,
      `SELECT ${SUMMARY_COLUMNS}, a.body_md AS bodyMd, a.created_at AS createdAt
       FROM articles a JOIN users u ON u.id = a.author_id WHERE a.id = ? AND a.group_id = ?`,
      id,
      ctx.groupId,
    );
    if (!row || !canAccessSection(ctx.role, row.section) || !canSeeArticle(ctx.user.id, ctx.role, row)) {
      throw notFound('Artikel nicht gefunden');
    }
    return { ...row, canEdit: canEditArticle(ctx.user.id, ctx.role, row) };
  };

  app.get(
    '/api/groups/:gid/articles',
    { schema: { params: gidParams, querystring: objectOf({ section: sectionProp, path: { type: 'string' } }, ['section']) } },
    (req) => {
      const ctx = requireMember(db, req);
      const { section, path } = req.query as { section: Section; path?: string };
      assertSection(ctx, section);
      const params: Record<string, string | number> = {
        gid: ctx.groupId,
        section,
        ...visibilityParams(ctx.user.id, ctx.role),
      };
      // node:sqlite lehnt unbenutzte benannte Parameter ab, daher :path nur bei Bedarf
      if (path !== undefined) params.path = parsePath(path);
      return allRows<ArticleSummary>(
        db,
        `SELECT ${SUMMARY_COLUMNS} FROM articles a JOIN users u ON u.id = a.author_id
         WHERE a.group_id = :gid AND a.section = :section ${path === undefined ? '' : 'AND a.path = :path'}
           AND ${VISIBLE_ARTICLE_SQL}
         ORDER BY a.title COLLATE NOCASE`,
        params,
      );
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
      // ... oder den Autor aus dessen eigenem Artikel.
      const authorRole = getRole(db, ctx.groupId, existing.authorId);
      if (authorRole && !canAccessSection(authorRole, input.section)) {
        throw forbidden('Der Autor hätte in diesem Bereich keinen Zugriff mehr auf seinen Artikel');
      }
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
