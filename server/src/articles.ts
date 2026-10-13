import { canAccessSection, type Article, type ArticleSummary } from '@pnp/shared';
import { getRow, type Db } from './db.ts';
import type { MemberContext } from './auth.ts';
import { canEditArticle, canSeeArticle } from './access.ts';
import { notFound } from './errors.ts';
import { folderPath } from './folders.ts';

/** Tabellen für Artikelabfragen: Artikel "a", Autor "u" */
export const ARTICLES_FROM = `articles a JOIN users u ON u.id = a.author_id`;

/** Spalten eines ArticleSummary für Abfragen über ARTICLES_FROM; statt des Pfads die Ordner-ID (siehe toSummary) */
export const SUMMARY_COLUMNS = `a.id, a.section, a.folder_id AS folderId, a.title, a.visibility, a.author_id AS authorId,
  u.email AS authorEmail, a.updated_at AS updatedAt,
  EXISTS (SELECT 1 FROM character_sheets s WHERE s.article_id = a.id) AS hasSheet`;

/** Zeile aus SUMMARY_COLUMNS: Ordner-ID statt Pfad, hasSheet als 0/1, canEdit fehlt noch */
export type SummaryRow<T extends ArticleSummary = ArticleSummary> = Omit<T, 'path' | 'hasSheet' | 'canEdit'> & {
  folderId: number | null;
  hasSheet: number;
};

/**
 * Macht aus einer Zeile die API-Form: Pfad statt Ordner-ID, hasSheet als Boolean (SQLite kennt keine Booleans),
 * dazu das Bearbeitungsrecht des Anfragenden.
 */
export function toSummary<T extends ArticleSummary>(
  { folderId, hasSheet, ...row }: SummaryRow<T>,
  pathOf: (folderId: number | null) => string,
  ctx: MemberContext,
): T {
  const canEdit = canEditArticle(ctx.user.id, ctx.role, row);
  return { ...row, path: pathOf(folderId), hasSheet: Boolean(hasSheet), canEdit } as unknown as T;
}

/** Liefert den Artikel nur, wenn der Anfragende ihn sehen darf - sonst 404. */
export function loadVisibleArticle(db: Db, ctx: MemberContext, id: number): Article {
  const row = getRow<SummaryRow<Article>>(
    db,
    `SELECT ${SUMMARY_COLUMNS}, a.body_md AS bodyMd, a.created_at AS createdAt
     FROM ${ARTICLES_FROM} WHERE a.id = ? AND a.group_id = ?`,
    id,
    ctx.groupId,
  );
  if (!row || !canAccessSection(ctx.role, row.section) || !canSeeArticle(ctx.user.id, ctx.role, row)) {
    throw notFound('Artikel nicht gefunden');
  }
  return toSummary<Article>(row, (folderId) => folderPath(db, folderId), ctx);
}
