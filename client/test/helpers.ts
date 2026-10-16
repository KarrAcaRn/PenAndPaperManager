import { vi } from 'vitest';
import {
  DEFAULT_PRESET_NAME,
  emptySheet,
  emptySheetState,
  type Article,
  type ArticleSummary,
  type Folder,
  type Group,
  type Member,
  type SessionUser,
  type Sheet,
  type SheetData,
  type SheetState,
  type SkillPreset,
} from '@pnp/shared';
import { api } from '../src/lib/api.ts';
import { session } from '../src/lib/session.svelte.ts';

export const GM: SessionUser = { id: 1, email: 'sl@test.de', isAdmin: false };
export const PLAYER: SessionUser = { id: 2, email: 'alice@test.de', isAdmin: false };
export const ADMIN: SessionUser = { id: 3, email: 'admin@test.de', isAdmin: true };
export const gmGroup: Group = { id: 7, name: 'Testrunde', role: 'gm' };
export const playerGroup: Group = { id: 7, name: 'Testrunde', role: 'player' };

export function signIn(user: SessionUser | null, groups: Group[] = []): void {
  session.user = user;
  session.groups = groups;
  session.ready = true;
}

export const summary = (over: Partial<ArticleSummary> = {}): ArticleSummary => ({
  id: 1,
  section: 'notes',
  path: '',
  title: 'Wirt',
  visibility: 'public',
  authorId: PLAYER.id,
  authorEmail: PLAYER.email,
  updatedAt: '2026-09-19 18:00:00',
  hasSheet: false,
  canEdit: true,
  ...over,
});

export const fullArticle = (over: Partial<Article> = {}): Article => ({
  ...summary(),
  bodyMd: '# Hallo',
  createdAt: '2026-09-19 18:00:00',
  canEdit: true,
  ...over,
});

export const folder = (path: string, canManage = true): Folder => ({ path, canManage });
export const member = (user: { id: number; email: string }, role: Member['role']): Member => ({ userId: user.id, email: user.email, role });

/** Bogen mit festen Schlüsseln für die Standard-Konsequenzen: l (leicht), m (mittel), s (schwer) */
export const sheetData = (over: Partial<SheetData> = {}): SheetData => ({
  ...emptySheet(),
  consequences: [
    { key: 'l', value: 2 },
    { key: 'm', value: 4 },
    { key: 's', value: 6 },
  ],
  ...over,
});
export const sheetState = (over: Partial<SheetState> = {}): SheetState => ({ ...emptySheetState(), ...over });
export const sheetOf = (data: Partial<SheetData> = {}, version = 1, state: Partial<SheetState> = {}, stateVersion = 1): Sheet => ({
  data: sheetData(data),
  version,
  state: sheetState(state),
  stateVersion,
});
export const presetFixture = (over: Partial<SkillPreset> = {}): SkillPreset => ({
  id: 1,
  name: DEFAULT_PRESET_NAME,
  description: 'Quelle',
  skills: ['Athletik', 'Wille'],
  ...over,
});

/** Leerer Ordner: weder Unterordner noch Artikel */
export function mockEmptyFolder(api: ReturnType<typeof mockApi>): void {
  api.folders.mockResolvedValue([]);
  api.articles.mockResolvedValue([]);
}

/** Ersetzt alle api-Funktionen durch Mocks; ungemockte Aufrufe schlagen sichtbar fehl. */
export function mockApi(): { [K in keyof typeof api]: ReturnType<typeof vi.fn> } {
  const mocks = {} as Record<string, ReturnType<typeof vi.fn>>;
  const target = api as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const key of Object.keys(api)) {
    mocks[key] = vi.spyOn(target, key).mockRejectedValue(new Error(`api.${key} nicht gemockt`)) as never;
  }
  return mocks as never;
}
