import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown.ts';

describe('renderMarkdown', () => {
  it('rendert Markdown', () => {
    expect(renderMarkdown('# Titel')).toContain('<h1>Titel</h1>');
    expect(renderMarkdown('**fett**')).toContain('<strong>fett</strong>');
    expect(renderMarkdown('a\nb')).toContain('<br>');
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('## Unter\n\n- a\n- b')).toMatch(/<h2>Unter<\/h2>[\s\S]*<li>a<\/li>/);
  });

  it('rendert, was der Editor erzeugen kann: Checklisten, Tabellen, Bilder', () => {
    expect(renderMarkdown('- [x] erledigt')).toMatch(/<input[^>]*checked[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked/);
    expect(renderMarkdown('| a |\n| --- |\n| 1 |')).toContain('<td>1</td>');
    expect(renderMarkdown('![Karte](https://x.de/k.png)')).toContain('<img src="https://x.de/k.png" alt="Karte">');
  });

  it('entfernt gefährliches HTML', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script');
    expect(renderMarkdown('<img src=x onerror="alert(1)">')).not.toContain('onerror');
    expect(renderMarkdown('[klick](javascript:alert(1))')).not.toContain('javascript:');
  });
});
