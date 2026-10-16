<script lang="ts">
  import type { ThemeInfo } from '@pnp/shared';
  import { themeCatalog } from './theme.ts';
  import { guestTheme, setGuestTheme } from './userSettings.svelte.ts';

  /**
   * Theme-Wahl ohne Login (Anmeldeseite): wirkt sofort und wird nur in diesem Browser gespeichert (localStorage).
   * Nach dem Login gilt die Wahl aus den Benutzereinstellungen.
   */
  let themes = $state<ThemeInfo[]>([]);
  let defaultName = $state('');
  let selected = $state(guestTheme() ?? '');

  themeCatalog()
    .then((catalog) => {
      themes = catalog.themes;
      defaultName = catalog.themes.find((t) => t.id === catalog.defaultTheme)?.name ?? catalog.defaultTheme;
      // gespeicherte Wahl gibt es nicht mehr: Auswahl zeigt die Vorgabe (angewendet wird ohnehin die Vorgabe)
      if (selected && !catalog.themes.some((t) => t.id === selected)) selected = '';
    })
    .catch(() => {
      // ohne Theme-Liste keine Auswahl; die Seite bleibt im aktuellen Theme
    });

  function change() {
    void setGuestTheme(selected || null);
  }
</script>

{#if themes.length > 1}
  <label class="guest-theme">
    Design
    <select bind:value={selected} onchange={change}>
      <option value="">Vorgabe der Seite ({defaultName})</option>
      {#each themes as theme (theme.id)}
        <option value={theme.id}>{theme.name}</option>
      {/each}
    </select>
  </label>
{/if}

<style>
  .guest-theme { display: flex; align-items: center; gap: 0.5rem; margin-top: 1rem; font-weight: 400; }
  select { width: auto; }
</style>
