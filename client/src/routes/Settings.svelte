<script lang="ts">
  import { THEME_LABELS, USER_SETTING_KEYS, USER_SETTING_OPTIONS, type UserSettings } from '@pnp/shared';
  import { ApiFailure } from '../lib/api.ts';
  import { href, router, type Route } from '../lib/router.svelte.ts';
  import StorageSettings from '../lib/storage/StorageSettings.svelte';
  import { createTask } from '../lib/task.svelte.ts';
  import { loadUserSettings, saveUserSettings } from '../lib/userSettings.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';

  type Key = keyof UserSettings;

  /** Auswahlfeld: eine Option aus den erlaubten Werten (USER_SETTING_OPTIONS), dargestellt als Umschalter */
  interface ChoiceField {
    key: Key;
    label: string;
    hint?: string;
    labels: Record<string, string>;
  }

  /**
   * Aufbau der Seite. Neue Einstellung: in shared/src/settings.ts anlegen und hier in eine Sektion eintragen
   * (oder eine neue Sektion ergänzen).
   */
  const sections: { title: string; fields: ChoiceField[] }[] = [
    {
      title: 'Darstellung',
      fields: [
        {
          key: 'theme',
          label: 'Farbschema',
          hint: '„Wie das System“ folgt der Hell-/Dunkel-Einstellung deines Geräts.',
          labels: THEME_LABELS,
        },
      ],
    },
  ];

  let saved = $state<UserSettings | null>(null);
  let draft = $state<UserSettings | null>(null);
  let fieldErrors = $state<Partial<Record<Key, string>>>({});
  let success = $state('');

  const loading = createTask();
  const saving = createTask();

  /** Rückkehr aus der Google-Anmeldung (#/settings?storageConnected=…); einmal beim Öffnen der Seite gelesen */
  const storageReturn: Extract<Route, { name: 'settings' }> = router.route.name === 'settings' ? { ...router.route } : { name: 'settings' };

  /** Parameter aus der Adresse nehmen, damit Neuladen oder Lesezeichen den Ablauf nicht wiederholen */
  function clearStorageParams() {
    if (location.hash !== href.settings()) history.replaceState(history.state, '', href.settings());
    router.route = { name: 'settings' };
  }

  const dirty = $derived(!!draft && !!saved && USER_SETTING_KEYS.some((key) => draft![key] !== saved![key]));

  const load = () =>
    loading.run(async () => {
      saved = await loadUserSettings();
      draft = { ...saved };
    });
  load();

  /** Fastify meldet Schemafehler als "Ungültige Eingabe: body/<feld> …" – dem Feld zuordnen, wenn möglich */
  function fieldOf(err: unknown): Key | null {
    if (!(err instanceof ApiFailure) || err.status !== 400) return null;
    const key = /body\/(\w+)/.exec(err.message)?.[1];
    return key && (USER_SETTING_KEYS as string[]).includes(key) ? (key as Key) : null;
  }

  function changed(key: Key) {
    success = '';
    delete fieldErrors[key];
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
    if (saved) draft = { ...saved };
    fieldErrors = {};
    success = '';
  }
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
      {#each sections as section (section.title)}
        <section class="card">
          <h2>{section.title}</h2>
          {#each section.fields as field (field.key)}
            {@const error = fieldErrors[field.key]}
            <fieldset
              class="choice"
              role="radiogroup"
              aria-describedby={[field.hint && `${field.key}-hint`, error && `${field.key}-error`].filter(Boolean).join(' ') ||
                undefined}
              aria-invalid={error ? true : undefined}
            >
              <legend>{field.label}</legend>
              <div class="options" class:invalid={!!error}>
                {#each USER_SETTING_OPTIONS[field.key] as option (option)}
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

  <div class="storage-section">
    <StorageSettings connectedId={storageReturn.storageConnected} oauthError={storageReturn.storageError} onParamsHandled={clearStorageParams} />
  </div>
</main>

<style>
  .settings { display: grid; gap: 1rem; }
  section h2 { margin-top: 0; font-size: 1.15rem; }
  .choice { border: none; margin: 0 0 0.75rem; padding: 0; min-width: 0; }
  .choice:last-child { margin-bottom: 0; }
  legend { font-weight: 600; padding: 0; margin-bottom: 0.35rem; }
  .hint { margin: 0.35rem 0 0; }

  /* Umschalter aus Radiobuttons: Pfeiltasten wechseln die Auswahl, Tab springt in die Gruppe und wieder heraus */
  .options { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .options.invalid { border-color: var(--danger); }
  .option { position: relative; margin: 0; font-weight: 400; }
  .option + .option { border-left: 1px solid var(--border); }
  .option input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
  .option span { display: block; padding: 0.4rem 0.9rem; background: var(--surface); cursor: pointer; }
  .option:hover span { color: var(--accent); }
  .option input:checked + span { background: var(--accent); color: var(--accent-text); }
  .option input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: -4px; }
  .option input:checked:focus-visible + span { outline-color: var(--accent-text); }
  .option input:disabled + span { opacity: 0.6; cursor: default; }

  /* Auf schmalen Bildschirmen untereinander statt nebeneinander */
  @media (max-width: 30rem) {
    .options { display: flex; flex-direction: column; }
    .option + .option { border-left: none; border-top: 1px solid var(--border); }
  }

  .success { color: var(--accent); font-weight: 600; }
  .storage-section { margin-top: 1.5rem; }
</style>
