export const SECTIONS = ['characters', 'notes', 'gm'] as const;
export type Section = (typeof SECTIONS)[number];

export const VISIBILITIES = ['private', 'private_gm', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const ROLES = ['gm', 'player'] as const;
export type Role = (typeof ROLES)[number];

export const SECTION_LABELS: Record<Section, string> = {
  characters: 'Charaktere',
  notes: 'Notizen',
  gm: 'Spielleiter',
};

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: 'Privat',
  private_gm: 'Privat & Spielleiter',
  public: 'Öffentlich',
};

export const ROLE_LABELS: Record<Role, string> = {
  gm: 'Spielleiter',
  player: 'Spieler',
};

export interface User {
  id: number;
  email: string;
}

/** Der eingeloggte Benutzer, wie ihn login/me liefern */
export interface SessionUser extends User {
  /** darf den Admin-Bereich nutzen (ADMIN_EMAILS) */
  isAdmin: boolean;
}

export interface Group {
  id: number;
  name: string;
  role: Role;
}

export interface Member {
  userId: number;
  email: string;
  role: Role;
}

export interface ArticleSummary {
  id: number;
  section: Section;
  path: string;
  title: string;
  visibility: Visibility;
  authorId: number;
  authorEmail: string;
  updatedAt: string;
  /** hat einen FATE-Bogen */
  hasSheet: boolean;
  /** Anfragender darf ihn bearbeiten (und z.B. im Ordnerbaum verschieben) */
  canEdit: boolean;
}

export interface Article extends ArticleSummary {
  bodyMd: string;
  createdAt: string;
}

export interface ArticleInput {
  section: Section;
  path: string;
  title: string;
  bodyMd: string;
  visibility: Visibility;
}

/**
 * Ändern eines Artikels. Ohne path bleibt er in seinem Ordner, auch wenn der inzwischen umbenannt oder
 * verschoben wurde - sonst holte ein offenes Formular den alten Ordnernamen zurück.
 */
export type ArticleUpdate = Omit<ArticleInput, 'path'> & { path?: string };

/** Ordner eines Bereichs; alle Mitglieder mit Zugriff auf den Bereich sehen alle Ordner */
export interface Folder {
  path: string;
  /** Ersteller oder Spielleiter: darf umbenennen, verschieben und (leer) löschen */
  canManage: boolean;
}

/** Fehlerantwort der API */
export interface ApiError {
  error: string;
}

export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 200_000;
export const MAX_GROUP_NAME_LENGTH = 100;
export const MAX_EMAIL_LENGTH = 254;
/** Anzahl der Ziffern im Login-Code, der per E-Mail verschickt wird */
export const LOGIN_CODE_LENGTH = 6;
export const MAX_RULE_QUERY_LENGTH = 200;
/** Höchstzahl der Suchtreffer, die der Server liefert */
export const MAX_RULE_HITS = 50;

/** Eintrag im Inhaltsverzeichnis eines Regelwerks */
export interface RulebookChapter {
  title: string;
  /** Seite im PDF, 1-basiert */
  page: number;
  /** Seitenzahl, wie sie im Buch gedruckt ist */
  label: string;
  /** Gliederungsebene, 0 = Kapitel */
  level: number;
}

export interface Rulebook {
  id: number;
  title: string;
  pageCount: number;
  chapters: RulebookChapter[];
  importedAt: string;
}

/** Treffer der Volltextsuche: eine Seite des Regelwerks mit Textausschnitt */
export interface RuleHit {
  rulebookId: number;
  page: number;
  label: string;
  chapter: string;
  /** Ausschnitt, die gefundenen Wörter sind als mark: true markiert */
  snippet: { text: string; mark: boolean }[];
}

/** Bereich, in dem man nach der Gruppenwahl landet */
export const DEFAULT_SECTION: Section = 'characters';

/** Ordner, die jede neue Gruppe vorab bekommt, damit eine Struktur vorgegeben ist */
export const DEFAULT_FOLDERS: Partial<Record<Section, readonly string[]>> = {
  notes: ['NPCs', 'Orte', 'Sessions'],
  gm: ['NPCs', 'Orte', 'Sessions'],
};

/** Der Bereich "Spielleiter" ist für Spieler komplett unsichtbar. */
export function canAccessSection(role: Role, section: Section): boolean {
  return section !== 'gm' || role === 'gm';
}

export function accessibleSections(role: Role): Section[] {
  return SECTIONS.filter((section) => canAccessSection(role, section));
}
