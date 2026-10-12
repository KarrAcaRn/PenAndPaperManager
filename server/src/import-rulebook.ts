// Spielt ein Regelwerk (PDF) ein: npm run import-rulebook -- <Datei oder URL> [Titel]
// Gibt es schon eines mit dem Titel, wird es ersetzt. Der laufende Server sieht es sofort.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { MAX_TITLE_LENGTH } from '@pnp/shared';
import { openDb } from './db.ts';
import { dbPath, rulebookDir } from './paths.ts';
import { importRulebook } from './rulebooks.ts';

const [source, titleArg] = process.argv.slice(2);
if (!source) {
  console.error('Aufruf: npm run import-rulebook -- <Datei oder URL> [Titel]');
  process.exit(1);
}

async function load(src: string): Promise<Uint8Array> {
  if (!/^https?:\/\//.test(src)) return readFileSync(src);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

function defaultTitle(src: string): string {
  const name = /^https?:\/\//.test(src) ? basename(new URL(src).pathname) : basename(src);
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // kaputte %-Sequenzen: Namen roh übernehmen
  }
  return decoded.replace(/\.pdf$/i, '').replace(/_/g, ' ');
}

const title = (titleArg ?? defaultTitle(source)).trim();
if (!title || title.length > MAX_TITLE_LENGTH) {
  console.error(`Bitte einen Titel mit 1 bis ${MAX_TITLE_LENGTH} Zeichen angeben.`);
  process.exit(1);
}
const pdf = await load(source);
const path = dbPath();
const rulebook = await importRulebook(openDb(path), rulebookDir(path), title, pdf);
console.log(`„${rulebook.title}“ eingespielt: ${rulebook.pageCount} Seiten, ${rulebook.chapters.length} Kapitel (ID ${rulebook.id}).`);
