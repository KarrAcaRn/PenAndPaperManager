import { canAccessSection, type Article, type ArticleSummary } from '@pnp/shared';
import { getRow, type Db } from './db.ts';
import type { MemberContext } from './auth.ts';
import { canEditArticle, canSeeArticle } from './access.ts';
import { notFound } from './errors.ts';

/** Tabellen für Artikelabfragen: Artikel "a", Autor "u", Ordnerpfad "fp" (NULL = oberste Ebene) */
export const ARTICLES_FROM = `articles a JOIN users u ON u.id = a.author_id LEFT JOIN folder_paths fp ON fp.id = a.folder_id`;

/** Pfad des Artikels wie in der API ('' = oberste Ebene) */
export const ARTICLE_PATH_SQL = `COALESCE(fp.path, '')`;

/** Spalten eines ArticleSummary für Abfragen über ARTICLES_FROM */
export const SUMMARY_COLUMNS = `a.id, a.section, ${ARTICLE_PATH_SQL} AS path, a.title, a.visibility, a.author_id AS authorId,
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
     FROM ${ARTICLES_FROM} WHERE a.id = ? AND a.group_id = ?`,
    id,
    ctx.groupId,
  );
  if (!row || !canAccessSection(ctx.role, row.section) || !canSeeArticle(ctx.user.id, ctx.role, row)) {
    throw notFound('Artikel nicht gefunden');
  }
  return toSummary({ ...row, canEdit: canEditArticle(ctx.user.id, ctx.role, row) });
}
