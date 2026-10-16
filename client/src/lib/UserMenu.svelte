<script lang="ts">
  import { href, router } from './router.svelte.ts';
  import { logout, session } from './session.svelte.ts';

  const onSettings = $derived(router.route.name === 'settings');
</script>

<!-- Eigener Block mit margin-left: auto, damit das Menü auch nach einem Umbruch (schmale Fenster) rechts steht -->
<div class="user-menu row">
  {#if session.user?.isAdmin}<a class="no-print" href={href.admin()}>Admin</a>{/if}
  <span class="muted email">{session.user?.email}</span>
  <button onclick={logout}>Logout</button>
  <a
    class="settings no-print"
    class:active={onSettings}
    href={href.settings()}
    aria-label="Einstellungen"
    title="Einstellungen"
    aria-current={onSettings ? 'page' : undefined}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle class="rim" cx="8" cy="8" r="4.6" />
      <circle cx="8" cy="8" r="1.7" />
      <path class="teeth" d="M12.5 8h2.8M3.5 8H.7M8 12.5v2.8M8 3.5V.7M11.18 11.18l1.98 1.98M4.82 11.18l-1.98 1.98M4.82 4.82 2.84 2.84M11.18 4.82l1.98-1.98" />
    </svg>
  </a>
</div>

<style>
  .user-menu { margin-left: auto; justify-content: flex-end; }
  .email { overflow-wrap: anywhere; }
  .settings {
    width: 2.25rem; height: 2.25rem; padding: 0.35rem; flex: none;
    display: flex; align-items: center; justify-content: center;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); color: var(--text);
  }
  .settings:hover { border-color: var(--accent); color: var(--accent); }
  .settings:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .settings.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .rim { stroke-width: 2.2; }
  .teeth { stroke-width: 2.6; }
</style>
