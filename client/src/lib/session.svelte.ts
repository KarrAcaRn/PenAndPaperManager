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
  // Nicht abwarten: Fehlen die Einstellungen, läuft die App mit den Vorgaben (bzw. dem zuletzt gespeicherten Theme).
  // Ohne Session (z.B. abgelaufenes Cookie) nichts vom vorherigen Benutzer stehen lassen.
  if (session.user) loadUserSettings().catch(() => {});
  else resetUserSettings();
  session.groups = session.user ? await api.groups() : [];
  session.ready = true;
}

/** Prüft den Code aus der E-Mail; bei Erfolg ist man eingeloggt und die Gruppen sind geladen. */
export async function verifyLoginCode(email: string, code: string): Promise<void> {
  const { user } = await api.verifyCode(email, code);
  session.groups = await api.groups();
  session.user = user;
  session.ready = true;
  loadUserSettings().catch(() => {});
}

export async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // Auch wenn der Server nicht erreichbar ist, soll der Logout lokal wirken.
  } finally {
    clear();
    navigate(href.login());
  }
}

export async function reloadGroups(): Promise<void> {
  session.groups = await api.groups();
}
