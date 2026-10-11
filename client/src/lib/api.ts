import type {
  ApiError,
  Article,
  ArticleInput,
  ArticleSummary,
  Folder,
  Group,
  Member,
  Role,
  Section,
  SessionUser,
  Sheet,
  SheetData,
  Skill,
  SkillInput,
  SkillPreset,
  SkillPresetInput,
} from '@pnp/shared';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Wird bei 401/403 aufgerufen, damit die Session auf abgelaufene Logins und geänderte Rollen reagieren kann.
 * (Als Callback, weil session.svelte.ts dieses Modul importiert.)
 */
let authErrorHandler: (status: 401 | 403) => void = () => {};
export function onAuthError(handler: typeof authErrorHandler): void {
  authErrorHandler = handler;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) authErrorHandler(res.status);
    throw new ApiFailure(res.status, (data as ApiError | null)?.error ?? `Fehler ${res.status}`);
  }
  return data as T;
}

const qs = (params: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)).toString();

export const api = {
  me: () => request<{ user: SessionUser | null }>('GET', '/auth/me'),
  login: (email: string) => request<SessionUser>('POST', '/auth/login', { email }),
  logout: () => request<unknown>('POST', '/auth/logout'),

  groups: () => request<Group[]>('GET', '/groups'),
  createGroup: (name: string, presetId?: number) => request<Group>('POST', '/groups', { name, presetId }),

  members: (gid: number) => request<Member[]>('GET', `/groups/${gid}/members`),
  invite: (gid: number, email: string) => request<Member>('POST', `/groups/${gid}/members`, { email }),
  setRole: (gid: number, uid: number, role: Role) => request<unknown>('PATCH', `/groups/${gid}/members/${uid}`, { role }),
  removeMember: (gid: number, uid: number) => request<unknown>('DELETE', `/groups/${gid}/members/${uid}`),

  articles: (gid: number, section: Section, path?: string) =>
    request<ArticleSummary[]>('GET', `/groups/${gid}/articles?${qs({ section, path })}`),
  article: (gid: number, id: number) => request<Article>('GET', `/groups/${gid}/articles/${id}`),
  createArticle: (gid: number, input: ArticleInput) => request<Article>('POST', `/groups/${gid}/articles`, input),
  updateArticle: (gid: number, id: number, input: ArticleInput) =>
    request<Article>('PUT', `/groups/${gid}/articles/${id}`, input),
  deleteArticle: (gid: number, id: number) => request<unknown>('DELETE', `/groups/${gid}/articles/${id}`),

  folders: (gid: number, section: Section) => request<Folder[]>('GET', `/groups/${gid}/folders?${qs({ section })}`),
  createFolder: (gid: number, section: Section, path: string) =>
    request<Folder>('POST', `/groups/${gid}/folders`, { section, path }),
  renameFolder: (gid: number, section: Section, path: string, newPath: string) =>
    request<Folder>('PATCH', `/groups/${gid}/folders`, { section, path, newPath }),
  deleteFolder: (gid: number, section: Section, path: string) =>
    request<unknown>('DELETE', `/groups/${gid}/folders?${qs({ section, path })}`),

  sheet: (gid: number, articleId: number) => request<Sheet>('GET', `/groups/${gid}/articles/${articleId}/sheet`),
  createSheet: (gid: number, articleId: number, data: SheetData) =>
    request<Sheet>('POST', `/groups/${gid}/articles/${articleId}/sheet`, data),
  saveSheet: (gid: number, articleId: number, sheet: Sheet) =>
    request<Sheet>('PUT', `/groups/${gid}/articles/${articleId}/sheet`, sheet),
  deleteSheet: (gid: number, articleId: number) => request<unknown>('DELETE', `/groups/${gid}/articles/${articleId}/sheet`),

  skills: (gid: number) => request<Skill[]>('GET', `/groups/${gid}/skills`),
  /** expected: Stand, von dem der Client ausgeht; hat ihn jemand anderes inzwischen geändert, gibt es 409 */
  saveSkills: (gid: number, skills: SkillInput[], expected?: Skill[]) =>
    request<Skill[]>('PUT', `/groups/${gid}/skills`, { skills, expected }),
  applyPreset: (gid: number, presetId: number, expected?: Skill[]) =>
    request<Skill[]>('POST', `/groups/${gid}/skills/from-preset`, { presetId, expected }),

  presets: () => request<SkillPreset[]>('GET', '/presets'),
  createPreset: (preset: SkillPresetInput) => request<SkillPreset>('POST', '/presets', preset),
  updatePreset: (id: number, preset: SkillPresetInput) => request<SkillPreset>('PUT', `/presets/${id}`, preset),
  deletePreset: (id: number) => request<unknown>('DELETE', `/presets/${id}`),
};
