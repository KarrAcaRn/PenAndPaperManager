import { dirname, join } from 'node:path';

/** Pfade aus der Umgebung, gemeinsam für Server und Kommandozeilen-Skripte */
export const dbPath = () => process.env.DB_PATH ?? join(import.meta.dirname, '../../data/app.db');

/** Die PDF-Dateien der Regelwerke liegen neben der Datenbank */
export const rulebookDir = (db: string) => join(dirname(db), 'rulebooks');

/** Mitgelieferte Themes (themes/ im Repo) */
export const builtinThemesDir = () => join(import.meta.dirname, '../../themes');

/** Themes des Seitenbetreibers: THEMES_DIR, sonst themes neben der Datenbank */
export const themesDir = (db: string) => process.env.THEMES_DIR ?? join(dirname(db), 'themes');
