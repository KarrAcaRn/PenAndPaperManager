import {
  MAX_STORAGE_PAGE_SIZE,
  type ApiError,
  type Article,
  type ArticleInput,
  type ArticleUpdate,
  type ArticleSummary,
  type BuiltinSoundList,
  type Folder,
  type Group,
  type Member,
  type PlaybackUrl,
  type Role,
  type RuleHit,
  type Rulebook,
  type Section,
  type SessionUser,
  type Sheet,
  type SheetData,
  type SheetState,
  type Skill,
  type SkillInput,
  type SkillPreset,
  type SkillPresetInput,
  type StorageConnection,
  type StorageConnectionInput,
  type StorageFilePage,
  type StorageFolderPage,
  type StorageProviderInfo,
  type UploadRequest,
  type ThemeInfo,
  type UploadTarget,
  type UserSettings,
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
  /** Ohne Login antwortet der Server mit 401 (ältere Versionen mit { user: null }) - beides heißt "nicht eingeloggt". */
  me: async (): Promise<{ user: SessionUser | null }> => {
    try {
      return await request<{ user: SessionUser | null }>('GET', '/auth/me');
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) return { user: null };
      throw err;
    }
  },
  /** Schickt einen Login-Code an die E-Mail-Adresse (Antwort 204 ohne Inhalt) */
  requestCode: (email: string) => request<unknown>('POST', '/auth/request-code', { email }),
  /** Prüft den Code; bei Erfolg setzt der Server das Session-Cookie */
  verifyCode: (email: string, code: string) => request<{ user: SessionUser }>('POST', '/auth/verify-code', { email, code }),
  logout: () => request<unknown>('POST', '/auth/logout'),

  settings: () => request<UserSettings>('GET', '/me/settings'),
  updateSettings: (changes: Partial<UserSettings>) => request<UserSettings>('PATCH', '/me/settings', changes),

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
  updateArticle: (gid: number, id: number, input: ArticleUpdate) =>
    request<Article>('PUT', `/groups/${gid}/articles/${id}`, input),
  /** Besitzer wechseln; article ist null, wenn der Anfragende ihn danach nicht mehr sehen darf */
  setArticleAuthor: (gid: number, id: number, authorId: number) =>
    request<{ article: Article | null }>('PUT', `/groups/${gid}/articles/${id}/author`, { authorId }),
  /** Nur den Ordner wechseln (im selben Bereich) */
  moveArticle: (gid: number, id: number, path: string) => request<Article>('PATCH', `/groups/${gid}/articles/${id}`, { path }),
  deleteArticle: (gid: number, id: number) => request<unknown>('DELETE', `/groups/${gid}/articles/${id}`),

  folders: (gid: number, section: Section) => request<Folder[]>('GET', `/groups/${gid}/folders?${qs({ section })}`),
  createFolder: (gid: number, section: Section, path: string) =>
    request<Folder>('POST', `/groups/${gid}/folders`, { section, path }),
  renameFolder: (gid: number, section: Section, path: string, newPath: string) =>
    request<Folder>('PATCH', `/groups/${gid}/folders`, { section, path, newPath }),
  deleteFolder: (gid: number, section: Section, path: string) =>
    request<unknown>('DELETE', `/groups/${gid}/folders?${qs({ section, path })}`),

  sheet: (gid: number, articleId: number) => request<Sheet>('GET', `/groups/${gid}/articles/${articleId}/sheet`),
  createSheet: (gid: number, articleId: number, data: SheetData, state?: SheetState) =>
    request<Sheet>('POST', `/groups/${gid}/articles/${articleId}/sheet`, { data, state }),
  /** Bogen (Bearbeiten-Modus); der Zustand bleibt unberührt */
  saveSheet: (gid: number, articleId: number, data: SheetData, version: number) =>
    request<Pick<Sheet, 'data' | 'version'>>('PUT', `/groups/${gid}/articles/${articleId}/sheet`, { data, version }),
  /** Zustand im Spiel (Stress, Konsequenztexte) */
  saveSheetState: (gid: number, articleId: number, state: SheetState, stateVersion: number) =>
    request<Pick<Sheet, 'state' | 'stateVersion'>>('PUT', `/groups/${gid}/articles/${articleId}/sheet/state`, { state, stateVersion }),
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

  rulebooks: () => request<Rulebook[]>('GET', '/rulebooks'),
  searchRules: (q: string, rulebookId?: number) =>
    request<RuleHit[]>('GET', `/rulebooks/search?${qs({ q, rulebookId: rulebookId?.toString() })}`),
  themes: () => request<{ themes: ThemeInfo[]; defaultTheme: string }>('GET', '/themes'),
  theme: (id: string) => request<{ theme: ThemeInfo }>('GET', `/themes/${encodeURIComponent(id)}`),

  // Externe Speicher fürs Soundboard (docs/soundboard-storage.md); Zugangsdaten gehen nur hinein, nie heraus
  storageProviders: () => request<StorageProviderInfo[]>('GET', '/storage/providers'),
  storageConnections: () => request<StorageConnection[]>('GET', '/storage/connections'),
  /** Der Server prüft die Verbindung vor dem Speichern; schlägt die Prüfung fehl, wird nichts gespeichert */
  createStorageConnection: (input: StorageConnectionInput) => request<StorageConnection>('POST', '/storage/connections', input),
  deleteStorageConnection: (cid: number) => request<unknown>('DELETE', `/storage/connections/${cid}`),
  /** Prüft erneut; der neue Status wird auch bei einem Fehler gespeichert (dann ApiFailure) */
  testStorageConnection: (cid: number) => request<StorageConnection>('POST', `/storage/connections/${cid}/test`),
  driveFolders: (cid: number, cursor?: string) =>
    request<StorageFolderPage>('GET', `/storage/google-drive/connections/${cid}/folders${cursor ? `?${qs({ cursor })}` : ''}`),
  /** { name } legt einen neuen Ordner an, { folderId } wählt einen vorhandenen */
  chooseDriveFolder: (cid: number, choice: { name: string } | { folderId: string }) =>
    request<StorageConnection>('PUT', `/storage/google-drive/connections/${cid}/folder`, choice),
  /**
   * Startet die Google-Anmeldung per Seitenwechsel (kein fetch – Google braucht das ganze Fenster). Zurück kommt der
   * Browser auf #/settings?storageConnected=<id> bzw. ?storageError=<Meldung>.
   */
  connectGoogleDrive: async (displayName?: string): Promise<void> => {
    window.location.assign(`/api/storage/google-drive/oauth/start${displayName ? `?${qs({ displayName })}` : ''}`);
  },

  // Soundboard: Standard-Sounds und Dateien in den eigenen Speichern
  builtinSounds: () => request<BuiltinSoundList>('GET', '/sounds/builtin'),
  storageFiles: (cid: number, cursor?: string) =>
    request<StorageFilePage>('GET', `/storage/connections/${cid}/files?${qs({ cursor, limit: String(MAX_STORAGE_PAGE_SIZE) })}`),
  /** Kurzlebige URL, mit der der Browser die Datei direkt beim Anbieter abspielt */
  playbackUrl: (cid: number, fileId: string) =>
    request<PlaybackUrl>('GET', `/storage/connections/${cid}/playback-url?${qs({ fileId })}`),
  /** Ziel für den direkten Upload zum Anbieter; die Datei selbst geht nie über unseren Server */
  requestUpload: (cid: number, upload: UploadRequest) => request<UploadTarget>('POST', `/storage/connections/${cid}/uploads`, upload),
  deleteStorageFile: (cid: number, fileId: string) =>
    request<unknown>('DELETE', `/storage/connections/${cid}/files?${qs({ fileId })}`),
};

/**
 * Für Links und den eingebetteten PDF-Viewer; page springt im PDF-Viewer des Browsers auf die Seite.
 * v (Importzeitpunkt) sorgt dafür, dass nach erneutem Einspielen nicht das alte PDF aus dem Cache kommt.
 */
export const rulebookPdfUrl = (book: Pick<Rulebook, 'id' | 'importedAt'>, page?: number) =>
  `/api/rulebooks/${book.id}/pdf?${qs({ v: book.importedAt })}${page ? `#page=${page}` : ''}`;
