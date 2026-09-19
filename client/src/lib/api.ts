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
  User,
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
  me: () => request<{ user: User | null }>('GET', '/auth/me'),
  login: (email: string) => request<User>('POST', '/auth/login', { email }),
  logout: () => request<unknown>('POST', '/auth/logout'),

  groups: () => request<Group[]>('GET', '/groups'),
  createGroup: (name: string) => request<Group>('POST', '/groups', { name }),

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
};
