import type { Role, Visibility } from '@pnp/shared';

interface ArticleAccess {
  authorId: number;
  visibility: Visibility;
}

export function canSeeArticle(userId: number, role: Role, article: ArticleAccess): boolean {
  if (article.authorId === userId) return true;
  if (article.visibility === 'public') return true;
  return article.visibility === 'private_gm' && role === 'gm';
}

/** Autor immer; Spielleiter bei allem, was sie sehen können. */
export function canEditArticle(userId: number, role: Role, article: ArticleAccess): boolean {
  if (article.authorId === userId) return true;
  return role === 'gm' && canSeeArticle(userId, role, article);
}

/**
 * SQL-Entsprechung von canSeeArticle für Tabellenalias "a".
 * Die benannten Parameter dazu liefert visibilityParams().
 */
export const VISIBLE_ARTICLE_SQL = `(a.author_id = :uid OR a.visibility = 'public' OR (a.visibility = 'private_gm' AND :isGm = 1))`;

export function visibilityParams(userId: number, role: Role): { uid: number; isGm: number } {
  return { uid: userId, isGm: role === 'gm' ? 1 : 0 };
}

export function canManageFolder(userId: number, role: Role, folder: { createdBy: number | null }): boolean {
  return role === 'gm' || folder.createdBy === userId;
}
