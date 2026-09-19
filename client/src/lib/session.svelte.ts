import type { Group, User } from '@pnp/shared';
import { api, onAuthError } from './api.ts';
import { href, navigate } from './router.svelte.ts';

export const session = $state<{ user: User | null; groups: Group[]; ready: boolean }>({
  user: null,
  groups: [],
  ready: false,
});

function clear(): void {
  session.user = null;
  session.groups = [];
}

// 401: Session abgelaufen oder woanders ausgeloggt -> Login zeigen.
// 403: evtl. wurde die eigene Rolle geändert oder man wurde entfernt -> Gruppen neu laden.
onAuthError((status) => {
  if (status === 401) clear();
  else if (session.user) reloadGroups().catch(() => {});
});

export async function loadSession(): Promise<void> {
  session.user = (await api.me()).user;
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
