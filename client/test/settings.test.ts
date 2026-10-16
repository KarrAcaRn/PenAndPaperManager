import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { DEFAULT_USER_SETTINGS } from '@pnp/shared';
import { ApiFailure } from '../src/lib/api.ts';
import { loadSession, logout, session } from '../src/lib/session.svelte.ts';
import { applyStoredTheme, userSettings } from '../src/lib/userSettings.svelte.ts';
import Settings from '../src/routes/Settings.svelte';
import { GM, mockApi, PLAYER, signIn } from './helpers.ts';

let api: ReturnType<typeof mockApi>;
const user = userEvent.setup();
const root = document.documentElement;

beforeEach(() => {
  api = mockApi();
  localStorage.clear();
  delete root.dataset.theme;
  userSettings.value = { ...DEFAULT_USER_SETTINGS };
  signIn(PLAYER);
});

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Speichern' }) as HTMLButtonElement;

describe('Einstellungsseite', () => {
  it('zeigt erst den Ladezustand und dann die gespeicherten Werte', async () => {
    let resolve!: (value: unknown) => void;
    api.settings.mockReturnValue(new Promise((r) => (resolve = r)));
    render(Settings);
    expect(screen.getByText('Lade Einstellungen …')).toBeTruthy();
    resolve({ theme: 'dark' });
    expect(await screen.findByRole('radiogroup', { name: 'Farbschema' })).toBeTruthy();
    expect(radio('Dunkel').checked).toBe(true);
    expect(radio('Hell').checked).toBe(false);
    expect(saveButton().disabled).toBe(true);
    // Das geladene Theme wirkt auch gleich auf die App
    expect(root.dataset.theme).toBe('dark');
  });

  it('zeigt bei neuen Benutzern die Vorgaben', async () => {
    api.settings.mockResolvedValue({ ...DEFAULT_USER_SETTINGS });
    render(Settings);
    expect((await screen.findByRole('radio', { name: 'Wie das System' }) as HTMLInputElement).checked).toBe(true);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('zeigt einen Ladefehler und lädt auf Wunsch erneut', async () => {
    api.settings.mockRejectedValueOnce(new ApiFailure(500, 'Interner Fehler'));
    render(Settings);
    expect((await screen.findByRole('alert')).textContent).toContain('Interner Fehler');
    api.settings.mockResolvedValue({ theme: 'light' });
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect((await screen.findByRole('radio', { name: 'Hell' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('speichert nur die Änderungen, meldet den Erfolg und wendet das Theme sofort an', async () => {
    api.settings.mockResolvedValue({ theme: 'system' });
    api.updateSettings.mockResolvedValue({ theme: 'dark' });
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Dunkel' }));
    expect(root.dataset.theme).toBeUndefined(); // erst nach dem Speichern
    expect(saveButton().disabled).toBe(false);
    await user.click(saveButton());
    expect(api.updateSettings).toHaveBeenCalledWith({ theme: 'dark' });
    expect(await screen.findByText('Einstellungen gespeichert.')).toBeTruthy();
    expect(root.dataset.theme).toBe('dark');
    expect(userSettings.value.theme).toBe('dark');
    expect(localStorage.getItem('pnp-theme')).toBe('dark');
    expect(saveButton().disabled).toBe(true);
  });

  it('ist per Tastatur bedienbar: Pfeiltasten wählen, Enter speichert', async () => {
    api.settings.mockResolvedValue({ theme: 'system' });
    api.updateSettings.mockResolvedValue({ theme: 'light' });
    render(Settings);
    await screen.findByRole('radiogroup', { name: 'Farbschema' });
    radio('Wie das System').focus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Hell').checked).toBe(true);
    await user.tab();
    expect(document.activeElement).toBe(saveButton());
    await user.keyboard('{Enter}');
    expect(api.updateSettings).toHaveBeenCalledWith({ theme: 'light' });
    expect(await screen.findByText('Einstellungen gespeichert.')).toBeTruthy();
    expect(root.dataset.theme).toBe('light');
  });

  it('zeigt Validierungsfehler des Servers am Feld und behält die Auswahl', async () => {
    api.settings.mockResolvedValue({ theme: 'system' });
    api.updateSettings.mockRejectedValue(
      new ApiFailure(400, 'Ungültige Eingabe: body/theme must be equal to one of the allowed values'),
    );
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Hell' }));
    await user.click(saveButton());
    const group = screen.getByRole('radiogroup', { name: 'Farbschema' });
    expect(await within(group).findByText(/body\/theme must be equal/)).toBeTruthy();
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toContain('theme-error');
    expect(radio('Hell').checked).toBe(true);
    expect(screen.queryByText('Einstellungen gespeichert.')).toBeNull();
    expect(root.dataset.theme).toBeUndefined();
    // Neue Auswahl nimmt den Fehler weg
    await user.click(radio('Dunkel'));
    expect(within(group).queryByText(/body\/theme/)).toBeNull();
  });

  it('meldet sonstige Speicherfehler unter dem Formular', async () => {
    api.settings.mockResolvedValue({ theme: 'system' });
    api.updateSettings.mockRejectedValue(new Error('Failed to fetch'));
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Dunkel' }));
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toContain('Speichern fehlgeschlagen: Failed to fetch');
    expect(saveButton().disabled).toBe(false);
  });

  it('verwirft ungespeicherte Änderungen', async () => {
    api.settings.mockResolvedValue({ theme: 'light' });
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Dunkel' }));
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(radio('Hell').checked).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });
});

describe('Theme beim Start', () => {
  it('lädt die Einstellungen mit der Session und wendet das Theme an', async () => {
    session.ready = false;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    api.settings.mockResolvedValue({ theme: 'dark' });
    await loadSession();
    await waitFor(() => expect(root.dataset.theme).toBe('dark'));
  });

  it('startet auch ohne erreichbare Einstellungen', async () => {
    session.ready = false;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    api.settings.mockRejectedValue(new Error('offline'));
    await loadSession();
    expect(session.ready).toBe(true);
    expect(root.dataset.theme).toBeUndefined();
  });

  it('übernimmt das zuletzt gespeicherte Theme vor dem Laden, ungültige Werte nicht', () => {
    localStorage.setItem('pnp-theme', 'dark');
    applyStoredTheme();
    expect(root.dataset.theme).toBe('dark');
    localStorage.setItem('pnp-theme', 'neon');
    applyStoredTheme();
    expect(root.dataset.theme).toBeUndefined();
  });

  it('setzt das Theme beim Logout zurück', async () => {
    api.settings.mockResolvedValue({ theme: 'dark' });
    api.updateSettings.mockResolvedValue({ theme: 'dark' });
    render(Settings);
    await waitFor(() => expect(root.dataset.theme).toBe('dark'));
    api.logout.mockResolvedValue({});
    await logout();
    expect(root.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('pnp-theme')).toBeNull();
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
    resolve({ theme: 'dark' });
    await new Promise((r) => setTimeout(r, 0));
    expect(root.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('pnp-theme')).toBeNull();
    expect(userSettings.value).toEqual(DEFAULT_USER_SETTINGS);
  });

  it('lässt sich nicht von einem früher gestarteten Laden überschreiben', async () => {
    let resolveFirst!: (value: unknown) => void;
    api.me.mockResolvedValue({ user: GM });
    api.groups.mockResolvedValue([]);
    api.settings.mockReturnValueOnce(new Promise((r) => (resolveFirst = r))).mockResolvedValue({ theme: 'system' });
    api.updateSettings.mockResolvedValue({ theme: 'dark' });
    await loadSession(); // erstes Laden hängt noch
    render(Settings);
    await user.click(await screen.findByRole('radio', { name: 'Dunkel' }));
    await user.click(saveButton());
    await screen.findByText('Einstellungen gespeichert.');
    resolveFirst({ theme: 'system' });
    await new Promise((r) => setTimeout(r, 0));
    expect(root.dataset.theme).toBe('dark');
    expect(userSettings.value.theme).toBe('dark');
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
    resolveFirst({ theme: 'dark' });
    await waitFor(() => expect(root.dataset.theme).toBe('dark'));
  });

  it('setzt das Theme zurück, wenn keine Session mehr besteht', async () => {
    localStorage.setItem('pnp-theme', 'dark');
    applyStoredTheme();
    api.me.mockResolvedValue({ user: null });
    await loadSession();
    expect(root.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('pnp-theme')).toBeNull();
  });
});
