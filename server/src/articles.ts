import { canAccessSection, type Article, type ArticleSummary } from '@pnp/shared';
import { getRow, type Db } from './db.ts';
import type { MemberContext } from './auth.ts';
import { canEditArticle, canSeeArticle } from './access.ts';
import { notFound } from './errors.ts';

/** Spalten eines ArticleSummary für Abfragen mit "articles a JOIN users u" */
export const SUMMARY_COLUMNS = `a.id, a.section, a.path, a.title, a.visibility, a.author_id AS authorId,
  u.email AS authorEmail, a.updated_at AS updatedAt,
  EXISTS (SELECT 1 FROM character_sheets s WHERE s.article_id = a.id) AS hasSheet`;

/** SQLite kennt keine Booleans - hasSheet kommt als 0/1 an. */
export function toSummary<T extends ArticleSummary>(row: T): T {
  return { ...row, hasSheet: Boolean(row.hasSheet) };
}

/** Liefert den Artikel nur, wenn der Anfragende ihn sehen darf - sonst 404. */
export function loadVisibleArticle(db: Db, ctx: MemberContext, id: number): Article {
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
  return toSummary({ ...row, canEdit: canEditArticle(ctx.user.id, ctx.role, row) });
}
