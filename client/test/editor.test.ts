import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { containsHtml, editorExtensions, escapeBlockStarts } from '../src/lib/editorExtensions.ts';
import { renderMarkdown } from '../src/lib/markdown.ts';

const renderMarkdownPlain = (markdown: string) => renderMarkdown(markdown).trim();

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

/** Markdown laden und wieder speichern, wie es der Editor nach einer Änderung tut */
function roundTrip(markdown: string): string {
  editor = new Editor({ element: document.createElement('div'), extensions: editorExtensions(), content: markdown, contentType: 'markdown' });
  return editor.getMarkdown().trim();
}

describe('escapeBlockStarts', () => {
  it('escapt Zeichen, die am Zeilenanfang einen Block beginnen würden', () => {
    expect(escapeBlockStarts('2025. war gut')).toBe('2025\\. war gut');
    expect(escapeBlockStarts('3) drei')).toBe('3\\) drei');
    expect(escapeBlockStarts('- kein Punkt\n+ plus\n# kein Titel')).toBe('\\- kein Punkt\n\\+ plus\n\\# kein Titel');
    expect(escapeBlockStarts('---\n===\n> Zitat\n```\n~~~')).toBe('\\---\n\\===\n\\> Zitat\n\\```\n\\~~~');
    expect(escapeBlockStarts('  - eingerückt')).toBe('  \\- eingerückt');
    expect(escapeBlockStarts('Titel\n--')).toBe('Titel\n\\--');
    expect(escapeBlockStarts('a | b\n--- | ---')).toBe('a | b\n\\--- | ---');
    expect(escapeBlockStarts('a | b\n| :-- | --: |')).toBe('a | b\n\\| :-- | --: |');
    expect(escapeBlockStarts('    kein Code\n    Folgezeile')).toBe('&#32;   kein Code\n    Folgezeile');
    expect(escapeBlockStarts('\tkein Code')).toBe('&#9;kein Code');
  });

  it('lässt normalen Text und schon escapte Zeichen in Ruhe', () => {
    for (const text of ['Hallo', '#hashtag', '-5 Grad', '1.5 Liter', '\\- schon escapt', 'a - b', '**fett**', 'a | b', '-> Pfeil']) {
      expect(escapeBlockStarts(text)).toBe(text);
    }
  });
});

describe('Editor-Markdown', () => {
  it('behält escapte Blockzeichen im Absatz bei', () => {
    for (const source of ['2025\\. war gut', '\\- kein Punkt', '\\# kein Titel', '\\---']) {
      expect(roundTrip(source)).toBe(source);
    }
    // ">" speichert TipTap als Entity – ebenfalls kein Zitat
    expect(roundTrip('\\> kein Zitat')).toBe('&gt; kein Zitat');
  });

  it('escapt auch Zeilen nach einem Zeilenumbruch im Absatz', () => {
    expect(roundTrip('Liste folgt:\n1\\. kein Eintrag')).toBe('Liste folgt:  \n1\\. kein Eintrag');
  });

  it('macht aus Absätzen weder Setext-Überschriften, Tabellen noch Codeblöcke', () => {
    for (const source of ['Titel\\\n\\--', 'a | b\\\n\\--- | ---']) {
      const saved = roundTrip(source);
      expect(renderMarkdownPlain(saved), saved).toMatch(/^<p>/);
    }
  });

  it('lässt echte Blöcke unverändert', () => {
    const source = '# Titel\n\n- a\n- b\n\n1. x\n2. y\n\n> Zitat\n\n---\n\nText **fett**';
    expect(roundTrip(source)).toBe(source);
  });
});

describe('containsHtml', () => {
  it('erkennt HTML-Blöcke, Inline-HTML und Kommentare', () => {
    expect(containsHtml('<details><summary>x</summary>y</details>')).toBe(true);
    expect(containsHtml('Text mit <u>unterstrichen</u>')).toBe(true);
    expect(containsHtml('<!-- SL-Notiz -->')).toBe(true);
    expect(containsHtml('- Liste mit <span style="color:red">rot</span>')).toBe(true);
    expect(containsHtml('| a |\n| --- |\n| <u>x</u> |')).toBe(true);
  });

  it('meldet normales Markdown nicht', () => {
    expect(containsHtml('# Titel\n\na < b & c, **fett**\n\n- [ ] Aufgabe')).toBe(false);
  });
});
