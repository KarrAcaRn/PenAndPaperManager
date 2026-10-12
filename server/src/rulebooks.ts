import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_RULE_HITS, type RuleHit, type Rulebook, type RulebookChapter } from '@pnp/shared';
import { allRows, getRow, insertRow, parseJson, run, transaction, type Db } from './db.ts';
import { notFound } from './errors.ts';

/** Text eines Regelwerks, wie er aus dem PDF gelesen wird */
export interface ExtractedRulebook {
  pageCount: number;
  chapters: RulebookChapter[];
  pages: { page: number; label: string; chapter: string; body: string }[];
}

const MAX_QUERY_WORDS = 12;

export const rulebookFile = (dir: string, id: number) => join(dir, `${id}.pdf`);

/**
 * Glättet den aus dem PDF gelesenen Text: Silbentrennung am Zeilenende wird zusammengefügt, Wörter in
 * Kapitälchen (im PDF z.B. "wAhr", "BÖser") werden ab dem zweiten Buchstaben kleingeschrieben.
 * Reine Großschreibung ("KOMPAKT") bleibt.
 */
export function cleanPageText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\u00ad/g, '')
    // Steuerzeichen (z.B. Aufzählungsglyphen als \u0007) - außer Zeilenumbrüchen
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    // Ergänzungsstrich ("Ein- und Ausgang") bleibt stehen
    .replace(/(\p{L}) ?-\n(?=\p{Ll})(?!(?:und|oder|bis|sowie)\b)/gu, '$1')
    .replace(/(\p{L}) ?-\n(?=\p{Ll})/gu, '$1- ')
    .replace(/(\p{L})-\n(?=\p{Lu})/gu, '$1-')
    .replace(/\p{L}+/gu, (word) =>
      // Abkürzungen im Plural ("NSCs") bleiben
      /\p{Ll}/u.test(word) && /\p{Lu}/u.test(word.slice(1)) && !/^\p{Lu}+s$/u.test(word)
        ? word[0] + word.slice(1).toLowerCase()
        : word,
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Kapitelangabe für jede Seite: der zuletzt begonnene Eintrag jeder Ebene, z.B. "Konflikte › Angreifen" */
function chapterPerPage(chapters: RulebookChapter[], pageCount: number): string[] {
  const sorted = [...chapters].sort((a, b) => a.page - b.page);
  const stack: string[] = [];
  const result: string[] = [];
  let next = 0;
  for (let page = 1; page <= pageCount; page++) {
    for (; next < sorted.length && sorted[next].page <= page; next++) {
      const { level, title } = sorted[next];
      stack.length = level;
      stack[level] = title;
    }
    result.push(stack.filter(Boolean).join(' › '));
  }
  return result;
}

export async function extractRulebook(pdf: Uint8Array): Promise<ExtractedRulebook> {
  // Erst hier laden: pdf.js ist groß und wird nur beim Einspielen gebraucht, nicht im laufenden Server.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Kopie: pdf.js darf den Puffer übernehmen, die Datei wird danach noch gespeichert.
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    const doc = await task.promise;
    const labels = (await doc.getPageLabels()) ?? [];
    const label = (page: number) => labels[page - 1] || String(page);

    const pageOf = async (dest: unknown): Promise<number | null> => {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit[0] == null) return null;
      const ref = explicit[0];
      if (typeof ref === 'number') return ref + 1;
      return (await doc.getPageIndex(ref)) + 1;
    };

    const chapters: RulebookChapter[] = [];
    type OutlineItem = { title: string; dest: unknown; items: OutlineItem[] };
    const walk = async (items: OutlineItem[], level: number) => {
      for (const item of items) {
        const page = await pageOf(item.dest).catch(() => null);
        const title = item.title.replace(/\s+/g, ' ').trim();
        if (page !== null && title) chapters.push({ title, page, label: label(page), level });
        await walk(item.items ?? [], level + 1);
      }
    };
    await walk(((await doc.getOutline()) ?? []) as OutlineItem[], 0);

    const chapterOf = chapterPerPage(chapters, doc.numPages);
    const pages: ExtractedRulebook['pages'] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      const raw = content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join('');
      pages.push({ page, label: label(page), chapter: chapterOf[page - 1], body: cleanPageText(raw) });
    }
    return { pageCount: doc.numPages, chapters, pages };
  } finally {
    await task.destroy();
  }
}

/**
 * Speichert PDF und Text. Gibt es schon ein Regelwerk mit diesem Titel, wird es ersetzt (die ID bleibt,
 * damit Links gültig bleiben).
 */
export function saveRulebook(db: Db, dir: string, title: string, pdf: Uint8Array, book: ExtractedRulebook): Rulebook {
  mkdirSync(dir, { recursive: true });
  let file = '';
  const saved = transaction(db, () => {
    const existing = getRow<{ id: number }>(db, 'SELECT id FROM rulebooks WHERE title = ?', title);
    const chaptersJson = JSON.stringify(book.chapters);
    let id: number;
    if (existing) {
      id = existing.id;
      run(
        db,
        `UPDATE rulebooks SET page_count = ?, chapters_json = ?, imported_at = datetime('now') WHERE id = ?`,
        book.pageCount,
        chaptersJson,
        id,
      );
      run(db, 'DELETE FROM rulebook_pages WHERE rulebook_id = ?', id);
    } else {
      id = insertRow(db, 'INSERT INTO rulebooks (title, page_count, chapters_json) VALUES (?, ?, ?)', title, book.pageCount, chaptersJson);
    }
    for (const p of book.pages) {
      run(
        db,
        'INSERT INTO rulebook_pages (rulebook_id, page, label, chapter, body) VALUES (?, ?, ?, ?, ?)',
        id,
        p.page,
        p.label,
        p.chapter,
        p.body,
      );
    }
    // Innerhalb der Transaktion schreiben: scheitert das, bleibt die Datenbank unverändert.
    // Ersetzt wird die alte Datei erst nach dem Commit.
    file = rulebookFile(dir, id);
    writeFileSync(`${file}.tmp`, pdf);
    return getRulebook(db, id);
  });
  renameSync(`${file}.tmp`, file);
  return saved;
}

export async function importRulebook(db: Db, dir: string, title: string, pdf: Uint8Array): Promise<Rulebook> {
  return saveRulebook(db, dir, title, pdf, await extractRulebook(pdf));
}

interface RulebookRow {
  id: number;
  title: string;
  page_count: number;
  chapters_json: string;
  imported_at: string;
}

const toRulebook = (r: RulebookRow): Rulebook => ({
  id: r.id,
  title: r.title,
  pageCount: r.page_count,
  chapters: parseJson<RulebookChapter[]>(r.chapters_json, []),
  importedAt: r.imported_at,
});

export function listRulebooks(db: Db): Rulebook[] {
  return allRows<RulebookRow>(db, 'SELECT * FROM rulebooks ORDER BY title COLLATE NOCASE').map(toRulebook);
}

export function getRulebook(db: Db, id: number): Rulebook {
  const row = getRow<RulebookRow>(db, 'SELECT * FROM rulebooks WHERE id = ?', id);
  if (!row) throw notFound('Regelwerk nicht gefunden');
  return toRulebook(row);
}

/**
 * Suchanfrage für FTS5: nur Wörter, jedes als Präfix ("konseq" findet "Konsequenzen"), alle müssen vorkommen.
 * Sonderzeichen der FTS-Syntax kommen so nie in die Abfrage.
 */
export function ftsQuery(query: string): string | null {
  const words = query.normalize('NFC').match(/[\p{L}\p{N}]+/gu)?.slice(0, MAX_QUERY_WORDS) ?? [];
  return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(' ');
}

const MARK_START = '\u0001';
const MARK_END = '\u0002';

function toSnippet(raw: string): RuleHit['snippet'] {
  return raw
    .replace(/\s+/g, ' ')
    .split(/[\u0001\u0002]/)
    .map((text, i) => ({ text, mark: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}

export function searchRules(db: Db, query: string, rulebookId?: number): RuleHit[] {
  const match = ftsQuery(query);
  if (match === null) return [];
  const rows = allRows<{ rulebook_id: number; page: number; label: string; chapter: string; snippet: string }>(
    db,
    `SELECT p.rulebook_id, p.page, p.label, p.chapter,
            snippet(rulebook_search, 1, '${MARK_START}', '${MARK_END}', '…', 24) AS snippet
     FROM rulebook_search JOIN rulebook_pages p ON p.id = rulebook_search.rowid
     WHERE rulebook_search MATCH ? AND (? IS NULL OR p.rulebook_id = ?)
     ORDER BY bm25(rulebook_search, 2.0, 1.0), p.page
     LIMIT ${MAX_RULE_HITS}`,
    match,
    rulebookId ?? null,
    rulebookId ?? null,
  );
  return rows.map((r) => ({ rulebookId: r.rulebook_id, page: r.page, label: r.label, chapter: r.chapter, snippet: toSnippet(r.snippet) }));
}
