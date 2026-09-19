<script lang="ts">
  import { DEFAULT_PRESET_NAME, MAX_GROUP_NAME_LENGTH, ROLE_LABELS, type SkillPreset } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { reloadGroups, session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';

  let name = $state('');
  // Ohne Gruppe wird das Anlegen direkt angeboten
  let showCreate = $state(session.groups.length === 0);
  let presets = $state<SkillPreset[]>([]);
  let presetId = $state<number | null>(null);
  const task = createTask();

  // Die Varianten sind nur ein Angebot: Lädt die Liste nicht, lässt sich die Gruppe trotzdem anlegen,
  // deshalb wird der Fehler dieses Tasks nicht angezeigt.
  createTask().run(async () => {
    presets = await api.presets();
    presetId = presets.find((p) => p.name === DEFAULT_PRESET_NAME)?.id ?? null;
  });

  function create(event: SubmitEvent) {
    event.preventDefault();
    task.run(async () => {
      const group = await api.createGroup(name, presetId ?? undefined);
      await reloadGroups();
      navigate(href.group(group.id));
    });
  }
</script>

<main class="narrow">
  <div class="row">
    <h1>Deine Gruppen</h1>
    <span class="spacer"></span>
    <UserMenu />
  </div>

  {#if session.groups.length > 0}
    <ul class="list card">
      {#each session.groups as group (group.id)}
        <li>
          <a class="title" href={href.group(group.id)}>{group.name}</a>
          <span class="spacer"></span>
          <span class="badge {group.role}">{ROLE_LABELS[group.role]}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p>Du bist noch in keiner Gruppe. Lege eine neue an – oder lass dich von einem Spielleiter einladen.</p>
  {/if}

  {#if showCreate}
    <form class="card create" onsubmit={create}>
      <label>
        Name der neuen Gruppe
        <input bind:value={name} required maxlength={MAX_GROUP_NAME_LENGTH} placeholder="z.B. Die Donnerstagsrunde" />
      </label>
      {#if presets.length > 0}
        <label>
          Fertigkeiten
          <select bind:value={presetId}>
            <option value={null}>Später festlegen</option>
            {#each presets as preset (preset.id)}
              <option value={preset.id}>{preset.name} ({preset.skills.length})</option>
            {/each}
          </select>
        </label>
      {/if}
      <p class="muted">Du wirst Spielleiter dieser Gruppe. Die Fertigkeiten kannst du später im Bereich Spielleiter anpassen.</p>
      {#if task.error}<p class="error">{task.error}</p>{/if}
      <button class="primary" disabled={task.busy}>Gruppe anlegen</button>
    </form>
  {:else}
    <p><button onclick={() => (showCreate = true)}>Neue Gruppe anlegen</button></p>
  {/if}
</main>

<style>
  .narrow { max-width: 36rem; }
  .create { margin-top: 1rem; }
</style>
