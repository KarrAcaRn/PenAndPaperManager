import type { Extensions, JSONContent, MarkdownRendererHelpers, RenderContext } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { marked } from 'marked';

/**
 * Zeichen, die am Zeilenanfang einen Block beginnen würden (Überschrift, Liste, Zitat, Trennlinie,
 * Setext-Unterstreichung "==="/"--", Tabellen-Trennzeile, Codezaun). TipTap escapt sie beim Speichern
 * nicht – aus dem Absatz "2025. war gut" würde sonst eine nummerierte Liste.
 */
const BLOCK_START = new RegExp(
  '^( {0,3})(?:' +
    [
      '(#{1,6}|[-+*])(?=[ \\t]|$)', // Überschrift, Aufzählung
      '(\\d{1,9})([.)])(?=[ \\t]|$)', // nummerierte Liste
      '>', // Zitat
      '(?:[-*_][ \\t]*){3,}$', // Trennlinie
      '(?:=+|-+)[ \\t]*$', // Setext-Unterstreichung
      '\\|?[ \\t]*:?-+:?[ \\t]*\\|[-:| \\t]*$', // Tabellen-Trennzeile "--- | ---"
      '`{3,}|~{3,}', // Codezaun
    ].join('|') +
    ')',
);
/** Ab 4 Leerzeichen oder Tab am Absatzanfang würde ein eingerückter Codeblock daraus */
const CODE_INDENT = /^(?: {4}|\t)/;

/** Escapt Blockzeichen am Anfang jeder Zeile eines Absatzes (auch nach Zeilenumbrüchen innerhalb). */
export function escapeBlockStarts(markdown: string): string {
  return markdown
    .split('\n')
    .map((line, index) => {
      if (index === 0 && CODE_INDENT.test(line)) return (line[0] === '\t' ? '&#9;' : '&#32;') + line.slice(1);
      const match = BLOCK_START.exec(line);
      if (!match) return line;
      const [whole, indent, , digits, delimiter] = match;
      // "12." -> "12\." ; alles andere: erstes Zeichen escapen ("\#", "\-", "\>", "\---", "\```")
      if (digits !== undefined) return `${indent}${digits}\\${delimiter}${line.slice(whole.length)}`;
      return `${indent}\\${line.slice(indent.length)}`;
    })
    .join('\n');
}

const EscapingParagraph = Paragraph.extend({
  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers, context: RenderContext) {
    const rendered: string = this.parent?.(node, helpers, context) ?? '';
    return escapeBlockStarts(rendered);
  },
});

export function editorExtensions(placeholder = ''): Extensions {
  return [
    // Unterstreichen gibt es in Markdown nicht; Absatz durch die escapende Variante ersetzt
    StarterKit.configure({
      underline: false,
      paragraph: false,
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    EscapingParagraph,
    TableKit,
    Image,
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => `Erledigt: ${node.textContent || 'leerer Eintrag'}` },
    }),
    Placeholder.configure({ placeholder }),
    // Wie in der Anzeige (lib/markdown.ts): einfache Zeilenumbrüche bleiben Zeilenumbrüche
    Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
  ];
}

/**
 * true, wenn der Text HTML (auch Kommentare) enthält. Der WYSIWYG-Editor kann das nicht abbilden und würde
 * es bei der ersten Änderung als Text speichern bzw. verwerfen.
 */
export function containsHtml(markdown: string): boolean {
  let found = false;
  // walkTokens besucht auch Listeneinträge und Tabellenzellen
  marked.walkTokens(marked.lexer(markdown, { gfm: true }), (token) => {
    if (token.type === 'html') found = true;
  });
  return found;
}
