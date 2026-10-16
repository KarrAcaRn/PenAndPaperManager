<script lang="ts">
  import { THEME_TOKEN_NAMES, type ThemeInfo, type ThemeToken } from '@pnp/shared';

  /**
   * Mini-Vorschau eines Themes für die Theme-Auswahl: Vorschaubild aus dem Manifest oder, ohne Bild, eine kleine
   * Seite aus den Farb-Tokens (hell und, falls vorhanden, dunkel). Alle Tokens werden als Custom Properties nur auf
   * die Vorschau gesetzt, so lösen auch Verweise wie var(--color-accent) im Theme selbst auf statt im aktiven.
   */
  let { theme }: { theme: ThemeInfo } = $props();

  const variants = $derived([
    { label: 'Hell', tokens: theme.tokens },
    ...(Object.keys(theme.darkTokens).length ? [{ label: 'Dunkel', tokens: { ...theme.tokens, ...theme.darkTokens } }] : []),
  ]);

  /** Tokens als style-Attribut (Themes stammen vom Seitenbetreiber und sind vom Server geprüft; Svelte maskiert das Attribut) */
  const styleOf = (tokens: Partial<Record<ThemeToken, string>>) =>
    THEME_TOKEN_NAMES.filter((t) => tokens[t] !== undefined).map((t) => `--${t}: ${tokens[t]}`).join('; ');
</script>

<span class="preview" aria-hidden="true">
  {#if theme.preview}
    <img src={theme.preview} alt="" loading="lazy" />
  {:else}
    {#each variants as variant (variant.label)}
      <span class="page" style={styleOf(variant.tokens)} title={variant.label}>
        <span class="surface">
          <span class="line text"></span>
          <span class="line muted"></span>
          <span class="button"></span>
        </span>
        <span class="swatches">
          <span class="swatch" style="background: var(--color-bg)"></span>
          <span class="swatch" style="background: var(--color-surface)"></span>
          <span class="swatch" style="background: var(--color-text)"></span>
          <span class="swatch" style="background: var(--color-accent)"></span>
        </span>
      </span>
    {/each}
  {/if}
</span>

<style>
  .preview { display: flex; gap: 0.4rem; margin-top: 0.25rem; }
  img { display: block; width: 100%; max-height: 6rem; object-fit: cover; border: var(--border); border-radius: var(--border-radius-small); }
  .page {
    flex: 1;
    display: grid;
    gap: 0.3rem;
    padding: 0.4rem;
    background: var(--color-bg);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--border-radius);
    font-family: var(--font-body);
  }
  .surface {
    display: grid;
    gap: 0.2rem;
    padding: 0.35rem;
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--border-radius);
  }
  .line { display: block; height: 0.3rem; border-radius: var(--border-radius); }
  .line.text { width: 80%; background: var(--color-text); }
  .line.muted { width: 55%; background: var(--color-text-muted); }
  .button { display: block; width: 2.2rem; height: 0.6rem; background: var(--color-accent); border-radius: var(--border-radius); }
  .swatches { display: flex; gap: 0.2rem; }
  .swatch { flex: 1; height: 0.5rem; border: var(--border-width) var(--border-style) var(--color-border); border-radius: var(--border-radius); }
</style>
