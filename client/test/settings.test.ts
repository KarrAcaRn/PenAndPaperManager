import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { DEFAULT_USER_SETTINGS, type ThemeInfo, type UserSettings } from '@pnp/shared';
import { ApiFailure } from '../src/lib/api.ts';
import { loadSession, logout, session } from '../src/lib/session.svelte.ts';
import { THEME_BASE_LINK_ID, THEME_LINK_ID } from '../src/lib/theme.ts';
import { applyPreferredTheme, forgetSiteDefaultTheme, resetUserSettings, userSettings } from '../src/lib/userSettings.svelte.ts';
import Settings from '../src/routes/Settings.svelte';
import Login from '../src/routes/Login.svelte';
import { GM, mockApi, PLAYER, signIn } from './helpers.ts';

let api: ReturnType<typeof mockApi>;
const user = userEvent.setup();
const root = document.documentElement;

const themeInfo = (id: string, name: string, over: Partial<ThemeInfo> = {}): ThemeInfo =>
  ({
    id,
    name,
    author: `Autorin von ${name}`,
    version: '1.0.0',
    stylesheet: `/themes/${id}/theme.css`,
    tokens: { 'color-bg': '#fff', 'color-accent': '#a00' },
    darkTokens: {},
    builtin: id === 'default',
    ...over,
  }) as ThemeInfo;

const THEMES = [
  themeInfo('default', 'Standard', { darkTokens: { 'color-bg': '#000' } }),
  themeInfo('wald', 'Wald', { description: 'Grün und ruhig' }),
  themeInfo('nacht', 'Nacht', { preview: '/themes/nacht/preview.png' }),
];
const catalog = (defaultTheme = 'default', themes = THEMES) => ({ themes, defaultTheme });
const settings = (over: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_USER_SETTINGS, ...over });

/**
 * jsdom lädt keine Stylesheets: neue Theme-Links melden „load“, wenn das Theme verfügbar ist, sonst „error“
 * (wie ein 404 für ein gelöschtes Theme).
 */
let available = new Set<string>();
let observer: MutationObserver;
const themeLinks = () =>
  [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => [l.id, l.getAttribute('href')]);

beforeEach(() => {
  api = mockApi();
  localStorage.clear();
  forgetSiteDefaultTheme();
  document.head.innerHTML = `<link id="${THEME_BASE_LINK_ID}" rel="stylesheet" href="/themes/default/theme.css">`;
  root.dataset.theme = 'default';
  delete root.dataset.colorScheme;
  userSettings.value = { ...DEFAULT_USER_SETTINGS };
  available = new Set(['default', 'wald', 'nacht']);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        const id = node instanceof HTMLLinkElement ? node.dataset.themePending : undefined;
        if (id) setTimeout(() => node.dispatchEvent(new Event(available.has(id) ? 'load' : 'error')), 0);
      }
    }
  });
  observer.observe(document.head, { childList: true });
  api.themes.mockResolvedValue(catalog());
  signIn(PLAYER);
});
afterEach(() => observer.disconnect());

const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement;

describe('Einstellungsseite', () => {
  it('zeigt erst den Ladezustand und dann die gespeicherten Werte', async () => {
    let resolve!: (value: unknown) => void;
    api.settings.mockReturnValue(new Promise((r) => (resolve = r)));
    render(Settings);
    expect(screen.getByText('Lade Einstellungen …')).toBeTruthy();
    resolve(settings({ colorScheme: 'dark', theme: 'wald' }));
    expect(await screen.findByRole('radiogroup', { name: 'Farbschema' })).toBeTruthy();
    expect(radio('Dunkel').checked).toBe(true);
    expect(radio('Hell').checked).toBe(false);
    expect(radio('Wald').checked).toBe(true);
    expect(saveButton().disabled).toBe(true);
    // Das geladene Aussehen wirkt auch gleich auf die App
    expect(root.dataset.colorScheme).toBe('dark');
    await waitFor(() => expect(root.dataset.theme).toBe('wald'));
  });

  it('zeigt bei neuen Benutzern die Vorgaben', async () => {
    api.settings.mockResolvedValue(settings());
    render(Settings);
    expect((await screen.findByRole('radio', { name: 'Wie das System' }) as HTMLInputElement).checked).toBe(true);
    expect(radio('Vorgabe der Seite').checked).toBe(true);
    expect(root.dataset.colorScheme).toBeUndefined();
    expect(root.dataset.theme).toBe('default');
  });

  it('zeigt einen Ladefehler und lädt auf Wunsch erneut', async () => {
    api.settings.mockRejectedValueOnce(new ApiFailure(500, 'Interner Fehler'));
    render(Settings);
    expect((await screen.findByRole('alert')).textContent).toContain('Interner Fehler');
    api.settings.mockResolvedValue(settings({ colorScheme: 'light' }));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect((await screen.findByRole('radio', { name: 'Hell' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('zeigt die Auswahl sofort als Vorschau, speichert nur die Änderungen und merkt sie sich erst dann', async () => {
    api.settings.mockResolvedValue(settings());
    api.updateSettings.mockResolvedValue(settings({ colorScheme: 'dark' }));
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Dunkel' }));
    expect(root.dataset.colorScheme).toBe('dark'); // Vorschau
    expect(localStorage.getItem('pnp-color-scheme')).toBeNull(); // noch nicht gemerkt
    expect(saveButton().disabled).toBe(false);
    await user.click(saveButton());
    expect(api.updateSettings).toHaveBeenCalledWith({ colorScheme: 'dark' });
    expect(await screen.findByText('Einstellungen gespeichert.')).toBeTruthy();
    expect(root.dataset.colorScheme).toBe('dark');
    expect(userSettings.value.colorScheme).toBe('dark');
    expect(localStorage.getItem('pnp-color-scheme')).toBe('dark');
    expect(saveButton().disabled).toBe(true);
  });

  it('ist per Tastatur bedienbar: Pfeiltasten wählen, Enter speichert', async () => {
    api.settings.mockResolvedValue(settings());
    api.updateSettings.mockResolvedValue(settings({ colorScheme: 'light' }));
    render(Settings);
    await screen.findByRole('radiogroup', { name: 'Farbschema' });
    radio('Wie das System').focus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Hell').checked).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(saveButton());
    await user.keyboard('{Enter}');
    expect(api.updateSettings).toHaveBeenCalledWith({ colorScheme: 'light' });
    expect(await screen.findByText('Einstellungen gespeichert.')).toBeTruthy();
    expect(root.dataset.colorScheme).toBe('light');
  });

  it('zeigt Validierungsfehler des Servers am Feld und behält die Auswahl', async () => {
    api.settings.mockResolvedValue(settings());
    api.updateSettings.mockRejectedValue(
      new ApiFailure(400, 'Ungültige Eingabe: body/colorScheme must be equal to one of the allowed values'),
    );
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Hell' }));
    await user.click(saveButton());
    const group = screen.getByRole('radiogroup', { name: 'Farbschema' });
    expect(await within(group).findByText(/body\/colorScheme must be equal/)).toBeTruthy();
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toContain('colorScheme-error');
    expect(radio('Hell').checked).toBe(true);
    expect(screen.queryByText('Einstellungen gespeichert.')).toBeNull();
    expect(localStorage.getItem('pnp-color-scheme')).toBeNull();
    // Neue Auswahl nimmt den Fehler weg
    await user.click(radio('Dunkel'));
    expect(within(group).queryByText(/body\/colorScheme/)).toBeNull();
  });

  it('meldet sonstige Speicherfehler unter dem Formular', async () => {
    api.settings.mockResolvedValue(settings());
    api.updateSettings.mockRejectedValue(new Error('Failed to fetch'));
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Dunkel' }));
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Speichern fehlgeschlagen: Failed to fetch');
    expect(saveButton().disabled).toBe(false);
  });

  it('verwirft ungespeicherte Änderungen samt Vorschau', async () => {
    api.settings.mockResolvedValue(settings({ colorScheme: 'light' }));
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Dunkel' }));
    await user.click(radio('Wald'));
    await waitFor(() => expect(root.dataset.theme).toBe('wald'));
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(radio('Hell').checked).toBe(true);
    expect(radio('Vorgabe der Seite').checked).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(root.dataset.colorScheme).toBe('light');
    await waitFor(() => expect(root.dataset.theme).toBe('default'));
  });
});

describe('Theme-Auswahl', () => {
  it('zeigt alle Themes mit Name, Autor, Beschreibung und Vorschau', async () => {
    api.settings.mockResolvedValue(settings());
    render(Settings);
    const group = await screen.findByRole('radiogroup', { name: 'Theme' });
    const options = within(group).getAllByRole('radio');
    expect(options).toHaveLength(4);
    expect(radio('Vorgabe der Seite').closest('label')!.textContent).toContain('derzeit Standard');
    const wald = radio('Wald').closest('label')!;
    expect(wald.textContent).toContain('von Autorin von Wald');
    expect(wald.textContent).toContain('Grün und ruhig');
    // Vorschau aus den Tokens: Farben als Custom Properties nur auf der Vorschau
    expect(wald.querySelector<HTMLElement>('.page')!.getAttribute('style')).toContain('--color-accent: #a00');
    // mit dunkler Variante zwei Vorschauen
    expect(radio('Standard').closest('label')!.querySelectorAll('.page')).toHaveLength(2);
    // Vorschaubild aus dem Manifest
    expect(radio('Nacht').closest('label')!.querySelector('img')!.getAttribute('src')).toBe('/themes/nacht/preview.png');
  });

  it('wendet die Wahl sofort an, speichert sie dauerhaft und lädt sie beim nächsten Mal', async () => {
    api.settings.mockResolvedValue(settings());
    api.updateSettings.mockResolvedValue(settings({ theme: 'wald' }));
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: /^Wald/ }));
    await waitFor(() => expect(root.dataset.theme).toBe('wald'));
    expect(themeLinks()).toEqual([
      [THEME_BASE_LINK_ID, '/themes/default/theme.css'],
      [THEME_LINK_ID, '/themes/wald/theme.css'],
    ]);
    // gemerkt wird nur eine ausdrückliche Wahl; „wald“ ist bisher nur Vorschau
    expect(localStorage.getItem('pnp-theme-id')).toBeNull();
    await user.click(saveButton());
    expect(api.updateSettings).toHaveBeenCalledWith({ theme: 'wald' });
    await screen.findByText('Einstellungen gespeichert.');
    await waitFor(() => expect(localStorage.getItem('pnp-theme-id')).toBe('wald'));
  });

  it('ist per Tastatur bedienbar: Pfeiltasten wechseln das Theme mit Vorschau', async () => {
    api.settings.mockResolvedValue(settings());
    api.updateSettings.mockResolvedValue(settings({ theme: 'wald' }));
    render(Settings);
    await screen.findByRole('radiogroup', { name: 'Theme' });
    radio('Vorgabe der Seite').focus();
    await user.keyboard('{ArrowDown}');
    expect(radio('Standard').checked).toBe(true);
    await user.keyboard('{ArrowDown}');
    expect(radio('Wald').checked).toBe(true);
    await waitFor(() => expect(root.dataset.theme).toBe('wald'));
    await user.keyboard('{Enter}');
    expect(api.updateSettings).toHaveBeenCalledWith({ theme: 'wald' });
  });

  it('nimmt die Vorschau zurück, wenn man die Seite ohne Speichern verlässt', async () => {
    api.settings.mockResolvedValue(settings());
    const { unmount } = render(Settings);
    await user.click(await screen.findByRole('radio', { name: /^Nacht/ }));
    await waitFor(() => expect(root.dataset.theme).toBe('nacht'));
    unmount();
    await waitFor(() => expect(root.dataset.theme).toBe('default'));
  });

  it('meldet ein vom Server abgelehntes Theme am Feld', async () => {
    api.settings.mockResolvedValue(settings());
    api.updateSettings.mockRejectedValue(new ApiFailure(400, 'Das Theme „wald“ gibt es nicht.'));
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: /^Wald/ }));
    await user.click(saveButton());
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(await within(group).findByText('Das Theme „wald“ gibt es nicht.')).toBeTruthy();
    expect(group.getAttribute('aria-invalid')).toBe('true');
  });

  it('nimmt das Vorgabe-Theme der Seite, wenn keine eigene Wahl besteht', async () => {
    api.themes.mockResolvedValue(catalog('nacht'));
    api.settings.mockResolvedValue(settings());
    render(Settings);
    await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(radio('Vorgabe der Seite').closest('label')!.textContent).toContain('derzeit Nacht');
    await waitFor(() => expect(root.dataset.theme).toBe('nacht'));
    // Vorgabe der Seite wird nicht als ID gemerkt: index.html lädt sie per Weiterleitung, auch wenn sie sich ändert
    expect(localStorage.getItem('pnp-theme-id')).toBeNull();
  });
});

describe('Wettläufe und Sperren', () => {
  it('lässt ein später fertiges, älteres Theme das inzwischen gewünschte nicht überschreiben', async () => {
    const first = applyPreferredTheme('wald');
    const second = applyPreferredTheme('default'); // schon aktiv: nichts zu laden
    expect(await second).toBe('default');
    expect(await first).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(root.dataset.theme).toBe('default');
    expect(themeLinks()).toEqual([[THEME_BASE_LINK_ID, '/themes/default/theme.css']]);
  });

  it('nimmt die Vorschau auch zurück, wenn man verwirft, bevor sie geladen ist', async () => {
    api.settings.mockResolvedValue(settings());
    render(Settings);
    await screen.findByRole('radiogroup', { name: 'Theme' });
    radio('Wald').click(); // ohne auf das Laden des Stylesheets zu warten
    await tick(); // nur bis Svelte den Knopf freigibt
    screen.getByRole('button', { name: 'Verwerfen' }).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(root.dataset.theme).toBe('default');
    expect(radio('Vorgabe der Seite').checked).toBe(true);
  });

  it('sperrt die Auswahl, solange gespeichert wird', async () => {
    let resolve!: (value: UserSettings) => void;
    api.settings.mockResolvedValue(settings());
    api.updateSettings.mockReturnValue(new Promise((r) => (resolve = r)));
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: /^Wald/ }));
    await user.click(saveButton());
    expect(radio('Nacht').matches(':disabled')).toBe(true);
    expect(radio('Dunkel').matches(':disabled')).toBe(true);
    resolve(settings({ theme: 'wald' }));
    await screen.findByText('Einstellungen gespeichert.');
    expect(radio('Nacht').matches(':disabled')).toBe(false);
  });
});

describe('Fallback bei gelöschtem Theme', () => {
  beforeEach(() => {
    session.ready = false;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
  });

  it('weicht ohne Fehler auf das Vorgabe-Theme der Seite aus', async () => {
    api.themes.mockResolvedValue(catalog('wald'));
    api.settings.mockResolvedValue(settings({ theme: 'weg' }));
    await loadSession();
    await waitFor(() => expect(root.dataset.theme).toBe('wald'));
    expect(localStorage.getItem('pnp-theme-id')).toBeNull(); // nächstes Mal gleich die Vorgabe der Seite
    expect(themeLinks().map(([, href]) => href)).toEqual(['/themes/default/theme.css', '/themes/wald/theme.css']);
  });

  it('nimmt das Basis-Theme, wenn auch das Vorgabe-Theme fehlt oder die Theme-Liste nicht lädt', async () => {
    root.dataset.theme = 'alt';
    available = new Set(['default']);
    api.themes.mockResolvedValue(catalog('wald'));
    api.settings.mockResolvedValue(settings({ theme: 'weg' }));
    await loadSession();
    await waitFor(() => expect(root.dataset.theme).toBe('default'));
    expect(localStorage.getItem('pnp-theme-id')).toBeNull();

    forgetSiteDefaultTheme();
    root.dataset.theme = 'alt';
    api.themes.mockRejectedValue(new Error('offline'));
    api.settings.mockResolvedValue(settings());
    await loadSession();
    await waitFor(() => expect(root.dataset.theme).toBe('default'));
  });
});

describe('Aussehen beim Start', () => {
  it('lädt die Einstellungen mit der Session und wendet sie an', async () => {
    session.ready = false;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    api.settings.mockResolvedValue(settings({ colorScheme: 'dark', theme: 'nacht' }));
    await loadSession();
    await waitFor(() => expect(root.dataset.theme).toBe('nacht'));
    expect(root.dataset.colorScheme).toBe('dark');
    expect(localStorage.getItem('pnp-theme-id')).toBe('nacht');
    expect(localStorage.getItem('pnp-color-scheme')).toBe('dark');
  });

  it('startet auch ohne erreichbare Einstellungen', async () => {
    session.ready = false;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    api.settings.mockRejectedValue(new Error('offline'));
    await loadSession();
    expect(session.ready).toBe(true);
    expect(root.dataset.colorScheme).toBeUndefined();
  });

  it('setzt das Aussehen beim Logout zurück', async () => {
    api.settings.mockResolvedValue(settings({ colorScheme: 'dark', theme: 'wald' }));
    render(Settings);
    await waitFor(() => expect(root.dataset.theme).toBe('wald'));
    api.logout.mockResolvedValue({});
    await logout();
    expect(root.dataset.colorScheme).toBeUndefined();
    expect(localStorage.getItem('pnp-color-scheme')).toBeNull();
    await waitFor(() => expect(root.dataset.theme).toBe('default'));
    expect(userSettings.value).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('übernimmt keine späte Antwort mehr nach dem Logout', async () => {
    let resolve!: (value: unknown) => void;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    api.settings.mockReturnValue(new Promise((r) => (resolve = r)));
    await loadSession();
    api.logout.mockResolvedValue({});
    await logout();
    resolve(settings({ colorScheme: 'dark', theme: 'wald' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(root.dataset.colorScheme).toBeUndefined();
    expect(root.dataset.theme).toBe('default');
    expect(userSettings.value).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('lässt sich nicht von einem früher gestarteten Laden überschreiben', async () => {
    let resolveFirst!: (value: unknown) => void;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    api.settings.mockReturnValueOnce(new Promise((r) => (resolveFirst = r))).mockResolvedValue(settings());
    api.updateSettings.mockResolvedValue(settings({ colorScheme: 'dark' }));
    await loadSession(); // erstes Laden hängt noch
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Dunkel' }));
    await user.click(saveButton());
    await screen.findByText('Einstellungen gespeichert.');
    resolveFirst(settings());
    await new Promise((r) => setTimeout(r, 0));
    expect(root.dataset.colorScheme).toBe('dark');
    expect(userSettings.value.colorScheme).toBe('dark');
  });

  it('übernimmt ein älteres Laden, wenn ein neueres fehlschlägt', async () => {
    let resolveFirst!: (value: unknown) => void;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    api.settings
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockRejectedValueOnce(new ApiFailure(500, 'Interner Fehler'));
    await loadSession();
    render(Settings);
    await screen.findByRole('alert');
    resolveFirst(settings({ colorScheme: 'dark' }));
    await waitFor(() => expect(root.dataset.colorScheme).toBe('dark'));
  });

  it('setzt das Aussehen zurück, wenn keine Session mehr besteht', async () => {
    localStorage.setItem('pnp-color-scheme', 'dark');
    root.dataset.colorScheme = 'dark';
    api.me.mockResolvedValue({ user: null });
    await loadSession();
    expect(root.dataset.colorScheme).toBeUndefined();
    expect(localStorage.getItem('pnp-color-scheme')).toBeNull();
  });
});

describe('Theme-Wahl für Gäste', () => {
  beforeEach(() => signIn(null));

  it('lässt auf der Anmeldeseite ein Theme wählen, wendet es an und merkt es im Browser', async () => {
    render(Login);
    const select = (await screen.findByRole('combobox', { name: 'Design' })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Vorgabe der Seite (Standard)', 'Standard', 'Wald', 'Nacht']);
    await user.selectOptions(select, 'Wald');
    await waitFor(() => expect(root.dataset.theme).toBe('wald'));
    expect(localStorage.getItem('pnp-guest-theme')).toBe('wald');
    expect(localStorage.getItem('pnp-theme-id')).toBe('wald');
  });

  it('nimmt die Gast-Wahl beim nächsten Besuch und nach dem Logout', async () => {
    localStorage.setItem('pnp-guest-theme', 'nacht');
    resetUserSettings();
    await waitFor(() => expect(root.dataset.theme).toBe('nacht'));
    expect(userSettings.value.theme).toBe('nacht');
  });

  it('kehrt mit „Vorgabe der Seite“ zum Vorgabe-Theme zurück und vergisst die Gast-Wahl', async () => {
    localStorage.setItem('pnp-guest-theme', 'wald');
    resetUserSettings();
    await waitFor(() => expect(root.dataset.theme).toBe('wald'));
    render(Login);
    const select = (await screen.findByRole('combobox', { name: 'Design' })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('wald'));
    await user.selectOptions(select, 'Vorgabe der Seite (Standard)');
    await waitFor(() => expect(root.dataset.theme).toBe('default'));
    expect(localStorage.getItem('pnp-guest-theme')).toBeNull();
    expect(localStorage.getItem('pnp-theme-id')).toBeNull();
  });

  it('fällt bei einer gelöschten Gast-Wahl auf die Vorgabe zurück und zeigt sie als ausgewählt', async () => {
    localStorage.setItem('pnp-guest-theme', 'weg');
    resetUserSettings();
    render(Login);
    const select = (await screen.findByRole('combobox', { name: 'Design' })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(''));
    expect(root.dataset.theme).toBe('default');
  });
});

describe('Inline-Skript in index.html (kein Aufblitzen)', () => {
  const html = Object.values(import.meta.glob<string>('../index.html', { query: '?raw', import: 'default', eager: true }))[0]!;
  const script = /<link id="theme-base"[^>]*>\s*<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

  /** führt das Skript mit eigenem document/localStorage aus, wie beim Parsen im <head> */
  function runScript(stored: Record<string, string>) {
    const written: string[] = [];
    const attributes: Record<string, string> = {};
    const storage = new Map(Object.entries(stored));
    const fakeDocument = {
      documentElement: { setAttribute: (name: string, value: string) => (attributes[name] = value) },
      write: (markup: string) => written.push(markup),
    };
    const fakeStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };
    new Function('document', 'localStorage', script)(fakeDocument, fakeStorage);
    return { written, attributes, storage: Object.fromEntries(storage) };
  }

  it('lädt das Basis-Theme immer statisch (rendert blockierend, auch wenn ein gewähltes Theme fehlt)', () => {
    expect(html).toContain('<link id="theme-base" rel="stylesheet" href="/themes/default/theme.css"');
    expect(html.indexOf('id="theme-base"')).toBeLessThan(html.indexOf('<script>'));
  });

  it('schreibt das zuletzt angewendete Theme und Farbschema vor dem ersten Zeichnen', () => {
    const { written, attributes } = runScript({ 'pnp-theme-id': 'wald', 'pnp-color-scheme': 'dark' });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('<link id="theme-stylesheet" rel="stylesheet" href="/themes/wald/theme.css"');
    // fehlt das Theme (404), wird der Link entfernt und das Basis-Theme bleibt
    expect(written[0]).toContain('onerror="this.remove();');
    expect(attributes).toEqual({ 'data-theme': 'wald', 'data-color-scheme': 'dark' });
  });

  it('nimmt ohne ausdrückliche (oder mit ungültiger) Wahl das aktuelle Vorgabe-Theme der Seite', () => {
    const cases: Record<string, string>[] = [{}, { 'pnp-theme-id': '"><script>', 'pnp-color-scheme': 'neon' }];
    for (const stored of cases) {
      const { written, attributes } = runScript(stored);
      expect(written).toHaveLength(1);
      expect(written[0]).toContain('<link id="theme-stylesheet" rel="stylesheet" href="/themes/site-default.css"');
      // welches Theme die Weiterleitung liefert, weiß erst die App
      expect(attributes).toEqual({ 'data-theme': '' });
    }
  });

  it('braucht für das ausdrücklich gewählte Basis-Theme keinen zweiten Link', () => {
    expect(runScript({ 'pnp-theme-id': 'default' })).toMatchObject({ written: [], attributes: {} });
  });

  it('übernimmt das früher unter pnp-theme gespeicherte Farbschema', () => {
    const { attributes, storage } = runScript({ 'pnp-theme': 'dark' });
    expect(attributes).toEqual({ 'data-color-scheme': 'dark', 'data-theme': '' });
    expect(storage).toEqual({ 'pnp-color-scheme': 'dark' });
  });

  it('läuft auch ohne localStorage', () => {
    const fakeDocument = { documentElement: { setAttribute: () => {} }, write: () => {} };
    const blocked = {
      getItem: () => {
        throw new Error('gesperrt');
      },
    };
    expect(() => new Function('document', 'localStorage', script)(fakeDocument, blocked)).not.toThrow();
  });
});
