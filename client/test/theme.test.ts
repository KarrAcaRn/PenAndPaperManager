import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_LINK_ID, applyTheme, currentTheme, getTheme, listThemes } from '../src/lib/theme.ts';

const links = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
const pendingLink = (id: string) => document.querySelector<HTMLLinkElement>(`link[data-theme-pending="${id}"]`)!;

beforeEach(() => {
  document.head.innerHTML = `<link id="${THEME_LINK_ID}" rel="stylesheet" href="/themes/default/theme.css">`;
  document.documentElement.dataset.theme = 'default';
});
afterEach(() => vi.unstubAllGlobals());

describe('Theme-API', () => {
  it('listet Themes und holt einzelne über die API', async () => {
    const fetch = vi.fn(async (url: string) =>
      Response.json(url.endsWith('/themes') ? { themes: [{ id: 'default' }, { id: 'sci-fi' }] } : { theme: { id: 'sci-fi' } }),
    );
    vi.stubGlobal('fetch', fetch);
    expect((await listThemes()).map((t) => t.id)).toEqual(['default', 'sci-fi']);
    expect(await getTheme('sci-fi')).toEqual({ id: 'sci-fi' });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/themes', '/api/themes/sci-fi']);
  });

  it('wechselt das Theme zur Laufzeit, das alte Stylesheet bleibt bis zum Laden aktiv', async () => {
    const done = applyTheme('dunkel');
    expect(links().map((l) => l.getAttribute('href'))).toEqual(['/themes/default/theme.css', '/themes/dunkel/theme.css']);
    expect(currentTheme()).toBe('default');
    pendingLink('dunkel').dispatchEvent(new Event('load'));
    await done;
    expect(links().map((l) => [l.id, l.getAttribute('href')])).toEqual([[THEME_LINK_ID, '/themes/dunkel/theme.css']]);
    expect(currentTheme()).toBe('dunkel');
    expect(document.documentElement.dataset.theme).toBe('dunkel');
  });

  it('behält das bisherige Theme, wenn das neue nicht lädt', async () => {
    const done = applyTheme('weg');
    pendingLink('weg').dispatchEvent(new Event('error'));
    await expect(done).rejects.toThrow('Das Theme „weg“ konnte nicht geladen werden.');
    expect(links().map((l) => l.getAttribute('href'))).toEqual(['/themes/default/theme.css']);
    expect(currentTheme()).toBe('default');
  });

  it('bei schnellen Wechseln gewinnt der letzte Aufruf, auch wenn ein älterer später lädt', async () => {
    const first = applyTheme('eins');
    const second = applyTheme('zwei');
    const firstLink = pendingLink('eins');
    pendingLink('zwei').dispatchEvent(new Event('load'));
    await second;
    firstLink.dispatchEvent(new Event('load'));
    await first;
    expect(links().map((l) => l.getAttribute('href'))).toEqual(['/themes/zwei/theme.css']);
    expect(currentTheme()).toBe('zwei');
  });
});

describe('Gestaltung nur über Tokens', () => {
  it('enthält in Komponenten und app.css keine festen Farbwerte', () => {
    const files = import.meta.glob<string>('../src/**/*.{svelte,css}', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(files).length).toBeGreaterThan(10);
    const found = Object.entries(files).flatMap(([f, text]) => {
      // nur die Styles prüfen (Markup kann z.B. #-Anker enthalten)
      const css = f.endsWith('.css') ? text : (text.match(/<style>[\s\S]*?<\/style>/g) ?? []).join('\n');
      return (css.match(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|color-mix)\(/gi) ?? []).map((m) => `${f}: ${m}`);
    });
    expect(found).toEqual([]);
  });
});
