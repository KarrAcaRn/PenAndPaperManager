import { dirname, join } from 'node:path';

/** Pfade aus der Umgebung, gemeinsam für Server und Kommandozeilen-Skripte */
export const dbPath = () => process.env.DB_PATH ?? join(import.meta.dirname, '../../data/app.db');

/** Die PDF-Dateien der Regelwerke liegen neben der Datenbank */
export const rulebookDir = (db: string) => join(dirname(db), 'rulebooks');
