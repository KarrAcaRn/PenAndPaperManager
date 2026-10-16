import type { Group, SessionUser } from '@pnp/shared';
import { api, onAuthError } from './api.ts';
import { href, navigate } from './router.svelte.ts';
import { loadUserSettings, resetUserSettings } from './userSettings.svelte.ts';

export const session = $state<{ user: SessionUser | null; groups: Group[]; ready: boolean }>({
  user: null,
  groups: [],
  ready: false,
});

function clear(): void {
  session.user = null;
  session.groups = [];
  resetUserSettings();
}

// 401: Session abgelaufen oder woanders ausgeloggt -> Login zeigen.
// 403: evtl. wurde die eigene Rolle geändert oder man wurde entfernt -> Gruppen neu laden.
onAuthError((status) => {
  if (status === 401) clear();
  else if (session.user) reloadGroups().catch(() => {});
});

export async function loadSession(): Promise<void> {
  session.user = (await api.me()).user;
  // Nicht abwarten: Fehlen die Einstellungen, läuft die App mit den Vorgaben (bzw. dem zuletzt gespeicherten Theme)
  if (session.user) loadUserSettings().catch(() => {});
  session.groups = session.user ? await api.groups() : [];
  session.ready = true;
}

export async function login(email: string): Promise<void> {
  await api.login(email);
  await loadSession();
}

export async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // Auch wenn der Server nicht erreichbar ist, soll der Logout lokal wirken.
  } finally {
    clear();
    navigate(href.groups());
  }
}

export async function reloadGroups(): Promise<void> {
  session.groups = await api.groups();
}
