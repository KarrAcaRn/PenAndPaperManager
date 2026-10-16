import { DEFAULT_SECTION, SECTIONS, joinPath, type Section } from '@pnp/shared';

export type Route =
  | { name: 'groups' }
  | { name: 'folder'; gid: number; section: Section; path: string }
  | { name: 'article'; gid: number; section: Section; id: number; edit: boolean }
  | { name: 'new'; gid: number; section: Section; path: string }
  | { name: 'manage'; gid: number }
  | { name: 'skills'; gid: number }
  | { name: 'rules'; gid: number }
  | { name: 'admin' }
  /** Soundboard; die Standard-Sounds gibt es auch ohne Login */
  | { name: 'sounds' }
  /** next: Seite (Hash), zu der es nach dem Login weitergeht */
  | { name: 'login'; next: string };

const isSection = (s: string | undefined): s is Section => SECTIONS.includes(s as Section);

/** Frühere Bereiche, die heute Ordner in "Notizen" sind (Migration 002) - alte Lesezeichen führen dorthin */
const LEGACY_SECTIONS: Record<string, string> = { npcs: 'NPCs', locations: 'Orte' };

/** Kaputte %-Sequenzen (z.B. von Hand getippt) bleiben roh stehen, statt die Seite abstürzen zu lassen. */
function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Nur Ziele innerhalb der App zulassen, und nicht wieder den Login selbst */
function loginTarget(next: string | undefined): string {
  return next?.startsWith('#/') && !next.startsWith('#/login') ? next : '#/';
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  const [g, gidRaw, rawSection, kind, ...rest] = parts;
  const legacyFolder = rawSection === undefined ? undefined : LEGACY_SECTIONS[rawSection];
  const section = legacyFolder === undefined ? rawSection : 'notes';
  const subPath = (path: string) => (legacyFolder === undefined || path === '' ? (legacyFolder ?? path) : joinPath(legacyFolder, path));
  if (g === 'admin') return { name: 'admin' };
  if (g === 'sounds') return { name: 'sounds' };
  if (g === 'login') return { name: 'login', next: loginTarget(gidRaw) };
  const gid = Number(gidRaw);
  if (g !== 'g' || !Number.isInteger(gid)) return { name: 'groups' };
  if (section === 'manage' || section === 'skills' || section === 'rules') return { name: section, gid };
  if (!isSection(section)) return { name: 'folder', gid, section: DEFAULT_SECTION, path: '' };
  if (kind === 'a' && Number.isInteger(Number(rest[0]))) {
    return { name: 'article', gid, section, id: Number(rest[0]), edit: rest[1] === 'edit' };
  }
  if (kind === 'new') return { name: 'new', gid, section, path: subPath(rest.join('/')) };
  return { name: 'folder', gid, section, path: subPath(kind === 'f' ? rest.join('/') : '') };
}

const encodePath = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export const href = {
  groups: () => '#/',
  /** Einstieg in eine Gruppe */
  group: (gid: number) => href.folder(gid, DEFAULT_SECTION),
  folder: (gid: number, section: Section, path = '') => `#/g/${gid}/${section}${path ? `/f/${encodePath(path)}` : ''}`,
  article: (gid: number, section: Section, id: number) => `#/g/${gid}/${section}/a/${id}`,
  edit: (gid: number, section: Section, id: number) => `#/g/${gid}/${section}/a/${id}/edit`,
  newArticle: (gid: number, section: Section, path = '') => `#/g/${gid}/${section}/new${path ? `/${encodePath(path)}` : ''}`,
  manage: (gid: number) => `#/g/${gid}/manage`,
  skills: (gid: number) => `#/g/${gid}/skills`,
  rules: (gid: number) => `#/g/${gid}/rules`,
  admin: () => '#/admin',
  sounds: () => '#/sounds',
  /** Login; next ist der Hash der ursprünglich angefragten Seite (ohne Angabe: Startseite) */
  login: (next?: string) => {
    const target = loginTarget(next);
    return target === '#/' ? '#/login' : `#/login/${encodeURIComponent(target)}`;
  },
};

export const router = $state({ route: parseHash(location.hash) });
window.addEventListener('hashchange', () => (router.route = parseHash(location.hash)));

export function navigate(to: string): void {
  location.hash = to;
}
