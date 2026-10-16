<script lang="ts">
  import { onDestroy } from 'svelte';
  import { COLOR_SCHEME_LABELS, COLOR_SCHEMES, USER_SETTING_KEYS, type ThemeInfo, type UserSettings } from '@pnp/shared';
  import { ApiFailure } from '../lib/api.ts';
  import { href } from '../lib/router.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import { themeCatalog } from '../lib/theme.ts';
  import { applyAppearance, loadUserSettings, saveUserSettings, userSettings } from '../lib/userSettings.svelte.ts';
  import ThemePreview from '../lib/ThemePreview.svelte';
  import UserMenu from '../lib/UserMenu.svelte';

  type Key = keyof UserSettings;

  /** Auswahlfeld: eine Option aus festen Werten, dargestellt als Umschalter */
  interface ChoiceField {
    key: Key;
    label: string;
    hint?: string;
    options: readonly string[];
    labels: Record<string, string>;
  }

  /**
   * Aufbau der Seite. Neue Einstellung: in shared/src/settings.ts anlegen und hier in eine Sektion eintragen
   * (oder eine neue Sektion ergänzen). Die Theme-Auswahl hat eine eigene Sektion (Karten mit Vorschau).
   */
  const sections: { title: string; fields: ChoiceField[] }[] = [
    {
      title: 'Darstellung',
      fields: [
        {
          key: 'colorScheme',
          label: 'Farbschema',
          hint: '„Wie das System“ folgt der Hell-/Dunkel-Einstellung deines Geräts. Wirkt bei Themes mit dunkler Variante.',
          options: COLOR_SCHEMES,
          labels: COLOR_SCHEME_LABELS,
        },
      ],
    },
  ];

  let saved = $state<UserSettings | null>(null);
  let draft = $state<UserSettings | null>(null);
  let themes = $state<ThemeInfo[]>([]);
  let defaultThemeId = $state('');
  let fieldErrors = $state<Partial<Record<Key, string>>>({});
  let success = $state('');

  const loading = createTask();
  const saving = createTask();

  const dirty = $derived(!!draft && !!saved && USER_SETTING_KEYS.some((key) => draft![key] !== saved![key]));
  const defaultThemeName = $derived(themes.find((t) => t.id === defaultThemeId)?.name ?? defaultThemeId);

  const load = () =>
    loading.run(async () => {
      const [settings, catalog] = await Promise.all([loadUserSettings(), themeCatalog()]);
      themes = catalog.themes;
      defaultThemeId = catalog.defaultTheme;
      saved = settings;
      draft = { ...settings };
    });
  load();

  /** Vorschau: Auswahl sofort zeigen, aber erst beim Speichern merken */
  const preview = () => draft && void applyAppearance(draft, { remember: false });

  // Seite ohne Speichern verlassen: wieder das gespeicherte Aussehen zeigen
  onDestroy(() => {
    if (dirty) void applyAppearance(userSettings.value);
  });

  /** Fastify meldet Schemafehler als "Ungültige Eingabe: body/<feld> …" – dem Feld zuordnen, wenn möglich */
  function fieldOf(err: unknown): Key | null {
    if (!(err instanceof ApiFailure) || err.status !== 400) return null;
    if (err.message.startsWith('Das Theme „')) return 'theme';
    const key = /body\/(\w+)/.exec(err.message)?.[1];
    return key && (USER_SETTING_KEYS as string[]).includes(key) ? (key as Key) : null;
  }

  function changed(key: Key) {
    success = '';
    delete fieldErrors[key];
    preview();
  }

  function pickTheme(id: string | null) {
    if (!draft) return;
    draft.theme = id;
    changed('theme');
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!draft || !saved) return;
    const changes: Partial<Record<Key, unknown>> = {};
    for (const key of USER_SETTING_KEYS) if (draft[key] !== saved[key]) changes[key] = draft[key];
    success = '';
    fieldErrors = {};
    const ok = await saving.run(async () => {
      try {
        saved = await saveUserSettings(changes as Partial<UserSettings>);
      } catch (err) {
        const key = fieldOf(err);
        if (key) fieldErrors[key] = (err as Error).message;
        throw err;
      }
      draft = { ...saved };
    });
    if (ok) success = 'Einstellungen gespeichert.';
  }

  function reset() {
    if (saved) {
      draft = { ...saved };
      void applyAppearance(saved);
    }
    fieldErrors = {};
    success = '';
  }

  const describedBy = (key: Key, hint: boolean) =>
    [hint && `${key}-hint`, fieldErrors[key] && `${key}-error`].filter(Boolean).join(' ') || undefined;
</script>

<main>
  <div class="row">
    <h1>Einstellungen</h1>
    <span class="spacer"></span>
    <a href={href.groups()}>Zu den Gruppen</a>
    <UserMenu />
  </div>

  <p class="muted">Diese Einstellungen gelten für deinen Login, in allen Gruppen und auf allen Geräten.</p>

  {#if loading.busy}
    <p class="muted" role="status">Lade Einstellungen …</p>
  {:else if loading.error || !draft}
    <div class="card" role="alert">
      <p class="error">Einstellungen konnten nicht geladen werden: {loading.error}</p>
      <button onclick={load}>Erneut versuchen</button>
    </div>
  {:else}
    <form class="settings" onsubmit={save} aria-busy={saving.busy}>
      <section class="card">
        <h2>Design</h2>
        <fieldset
          class="choice"
          role="radiogroup"
          aria-describedby={describedBy('theme', true)}
          aria-invalid={fieldErrors.theme ? true : undefined}
          disabled={saving.busy}
        >
          <legend>Theme</legend>
          <div class="themes" class:invalid={!!fieldErrors.theme}>
            <label class="theme-card">
              <input
                type="radio"
                name="theme"
                value=""
                checked={draft.theme === null}
                onchange={() => pickTheme(null)}
                aria-labelledby="site-default-choice-name"
                aria-describedby="site-default-choice-meta"
              />
              <span class="theme-body">
                <span class="theme-name" id="site-default-choice-name">Vorgabe der Seite</span>
                <span class="muted theme-meta" id="site-default-choice-meta">
                  derzeit {defaultThemeName}; folgt der Wahl des Seitenbetreibers
                </span>
                {#if themes.find((t) => t.id === defaultThemeId)}
                  <ThemePreview theme={themes.find((t) => t.id === defaultThemeId)!} />
                {/if}
              </span>
            </label>
            {#each themes as theme (theme.id)}
              <label class="theme-card">
                <input
                  type="radio"
                  name="theme"
                  value={theme.id}
                  checked={draft.theme === theme.id}
                  onchange={() => pickTheme(theme.id)}
                  aria-labelledby="themecard-{theme.id}-name"
                  aria-describedby="themecard-{theme.id}-meta"
                />
                <span class="theme-body">
                  <span class="theme-name" id="themecard-{theme.id}-name">{theme.name}</span>
                  <span class="muted theme-meta" id="themecard-{theme.id}-meta" title={theme.description}>
                    von {theme.author}{#if theme.description}<span class="theme-description">{' – '}{theme.description}</span>{/if}
                  </span>
                  <ThemePreview {theme} />
                </span>
              </label>
            {/each}
          </div>
          <p class="muted hint" id="theme-hint">Die Auswahl wirkt sofort als Vorschau; „Speichern“ übernimmt sie dauerhaft.</p>
          {#if fieldErrors.theme}<p class="error" id="theme-error">{fieldErrors.theme}</p>{/if}
        </fieldset>
      </section>

      {#each sections as section (section.title)}
        <section class="card">
          <h2>{section.title}</h2>
          {#each section.fields as field (field.key)}
            {@const error = fieldErrors[field.key]}
            <fieldset
              class="choice"
              role="radiogroup"
              aria-describedby={describedBy(field.key, !!field.hint)}
              aria-invalid={error ? true : undefined}
              disabled={saving.busy}
            >
              <legend>{field.label}</legend>
              <div class="options" class:invalid={!!error}>
                {#each field.options as option (option)}
                  <label class="option">
                    <input
                      type="radio"
                      name={field.key}
                      value={option}
                      bind:group={draft[field.key]}
                      onchange={() => changed(field.key)}
                    />
                    <span>{field.labels[option] ?? option}</span>
                  </label>
                {/each}
              </div>
              {#if field.hint}<p class="muted hint" id="{field.key}-hint">{field.hint}</p>{/if}
              {#if error}<p class="error" id="{field.key}-error">{error}</p>{/if}
            </fieldset>
          {/each}
        </section>
      {/each}

      <div class="row actions">
        <button class="primary" disabled={!dirty || saving.busy}>{saving.busy ? 'Speichere …' : 'Speichern'}</button>
        <button type="button" onclick={reset} disabled={!dirty || saving.busy}>Verwerfen</button>
        <span role="status">
          {#if success}<span class="success">{success}</span>{/if}
        </span>
      </div>
      {#if saving.error && !Object.keys(fieldErrors).length}
        <p class="error" role="alert">Speichern fehlgeschlagen: {saving.error}</p>
      {/if}
    </form>
  {/if}
</main>

<style>
  .settings { display: grid; gap: 1rem; }
  section h2 { margin-top: 0; font-size: 1.15rem; }
  .choice { border: none; margin: 0 0 0.75rem; padding: 0; min-width: 0; }
  .choice:last-child { margin-bottom: 0; }
  legend { font-weight: 600; padding: 0; margin-bottom: 0.35rem; }
  .hint { margin: 0.35rem 0 0; }

  /* Umschalter aus Radiobuttons: Pfeiltasten wechseln die Auswahl, Tab springt in die Gruppe und wieder heraus */
  .options { display: inline-flex; flex-wrap: wrap; border: var(--border); border-radius: var(--border-radius); overflow: hidden; }
  .options.invalid, .themes.invalid { border-color: var(--color-danger); }
  .option { position: relative; margin: 0; font-weight: 400; }
  .option + .option { border-left: var(--border); }
  .option input, .theme-card input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
  .option span { display: block; padding: 0.4rem 0.9rem; background: var(--color-surface); cursor: pointer; }
  .option:hover span { color: var(--color-accent); }
  .option input:checked + span { background: var(--color-accent); color: var(--color-accent-text); }
  .option input:focus-visible + span { outline: var(--outline-width) solid var(--color-accent); outline-offset: -4px; }
  .option input:checked:focus-visible + span { outline-color: var(--color-accent-text); }
  .option input:disabled + span { opacity: 0.6; cursor: default; }

  /* Auf schmalen Bildschirmen untereinander statt nebeneinander */
  @media (max-width: 30rem) {
    .options { display: flex; flex-direction: column; }
    .option + .option { border-left: none; border-top: var(--border); }
  }

  /* Theme-Karten: ebenfalls eine Radiogruppe (Pfeiltasten wählen und zeigen sofort die Vorschau) */
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 0.75rem; }
  .theme-card { position: relative; margin: 0; font-weight: 400; cursor: pointer; }
  .theme-body {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    height: 100%;
    padding: 0.6rem;
    border: var(--border);
    border-radius: var(--border-radius);
    background: var(--color-surface);
  }
  /* Vorschau unten bündig, damit die Karten einer Zeile gleich aussehen */
  .theme-body > :global(.preview) { margin-top: auto; }
  .theme-card:hover .theme-body { border-color: var(--color-accent); }
  .theme-card input:checked + .theme-body {
    border-color: var(--color-accent);
    box-shadow: inset 0 0 0 var(--border-width-strong) var(--color-accent);
  }
  .theme-card input:focus-visible + .theme-body { outline: var(--outline-width) solid var(--color-accent); outline-offset: 2px; }
  /* Hochkontrastmodus: Rahmenfarben und Schatten fallen weg, die Auswahl braucht eine eigene Markierung */
  @media (forced-colors: active) {
    .theme-card input:checked + .theme-body { outline: var(--border-width-strong) solid Highlight; outline-offset: -4px; }
  }
  .theme-name { font-weight: 600; }
  .theme-meta { font-size: 0.85rem; }
  /* lange Beschreibungen kürzen; vollständig bleiben sie über aria-describedby vorlesbar */
  .theme-meta {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }

  .success { color: var(--color-accent); font-weight: 600; }
</style>
