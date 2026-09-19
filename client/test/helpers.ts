import { vi } from 'vitest';
import type { Article, ArticleSummary, Folder, Group, Member, User } from '@pnp/shared';
import { api } from '../src/lib/api.ts';
import { session } from '../src/lib/session.svelte.ts';

export const GM: User = { id: 1, email: 'sl@test.de' };
export const PLAYER: User = { id: 2, email: 'alice@test.de' };
export const gmGroup: Group = { id: 7, name: 'Testrunde', role: 'gm' };
export const playerGroup: Group = { id: 7, name: 'Testrunde', role: 'player' };

export function signIn(user: User | null, groups: Group[] = []): void {
  session.user = user;
  session.groups = groups;
  session.ready = true;
}

export const summary = (over: Partial<ArticleSummary> = {}): ArticleSummary => ({
  id: 1,
  section: 'npcs',
  path: '',
  title: 'Wirt',
  visibility: 'public',
  authorId: PLAYER.id,
  authorEmail: PLAYER.email,
  updatedAt: '2026-09-19 18:00:00',
  ...over,
});

export const fullArticle = (over: Partial<Article> = {}): Article => ({
  ...summary(),
  bodyMd: '# Hallo',
  createdAt: '2026-09-19 18:00:00',
  canEdit: true,
  ...over,
});

export const folder = (path: string, canManage = true): Folder => ({ path, explicit: true, canManage });
export const member = (user: User, role: Member['role']): Member => ({ userId: user.id, email: user.email, role });

/** Leerer Ordner: weder Unterordner noch Artikel */
export function mockEmptyFolder(api: ReturnType<typeof mockApi>): void {
  api.folders.mockResolvedValue([]);
  api.articles.mockResolvedValue([]);
}

/** Ersetzt alle api-Funktionen durch Mocks; ungemockte Aufrufe schlagen sichtbar fehl. */
export function mockApi(): { [K in keyof typeof api]: ReturnType<typeof vi.fn> } {
  const mocks = {} as Record<string, ReturnType<typeof vi.fn>>;
  for (const key of Object.keys(api) as (keyof typeof api)[]) {
    mocks[key] = vi.spyOn(api, key).mockRejectedValue(new Error(`api.${key} nicht gemockt`)) as never;
  }
  return mocks as never;
}
