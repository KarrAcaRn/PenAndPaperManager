import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown.ts';

describe('renderMarkdown', () => {
  it('rendert Markdown', () => {
    expect(renderMarkdown('# Titel')).toContain('<h1>Titel</h1>');
    expect(renderMarkdown('**fett**')).toContain('<strong>fett</strong>');
    expect(renderMarkdown('a\nb')).toContain('<br>');
    expect(renderMarkdown('')).toBe('');
  });

  it('entfernt gefährliches HTML', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script');
    expect(renderMarkdown('<img src=x onerror="alert(1)">')).not.toContain('onerror');
    expect(renderMarkdown('[klick](javascript:alert(1))')).not.toContain('javascript:');
  });
});
