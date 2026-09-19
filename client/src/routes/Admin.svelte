<script lang="ts">
  import { MAX_PRESET_DESCRIPTION_LENGTH, MAX_PRESET_NAME_LENGTH, type SkillInput, type SkillPreset } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { href } from '../lib/router.svelte.ts';
  import { session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import SkillListEditor from '../lib/SkillListEditor.svelte';
  import UserMenu from '../lib/UserMenu.svelte';

  interface Draft {
    id: number | null;
    name: string;
    description: string;
    skills: SkillInput[];
  }

  let presets = $state<SkillPreset[]>([]);
  let draft = $state<Draft | null>(null);
  const task = createTask();

  const load = async () => {
    presets = await api.presets();
  };
  if (session.user?.isAdmin) task.run(load);

  const edit = (preset?: SkillPreset) =>
    (draft = {
      id: preset?.id ?? null,
      name: preset?.name ?? '',
      description: preset?.description ?? '',
      skills: (preset?.skills ?? []).map((name) => ({ name })),
    });

  function save(event: SubmitEvent) {
    event.preventDefault();
    const { id, name, description, skills } = draft!;
    const input = { name, description, skills: skills.map((s) => s.name) };
    task.run(async () => {
      await (id === null ? api.createPreset(input) : api.updatePreset(id, input));
      draft = null;
      await load();
    });
  }

  function remove(preset: SkillPreset) {
    if (!confirm(`Variante „${preset.name}“ löschen? Gruppen, die sie schon übernommen haben, sind nicht betroffen.`)) return;
    task.run(async () => {
      await api.deletePreset(preset.id);
      await load();
    });
  }
</script>

<main>
  <div class="row">
    <h1>Admin: Fertigkeiten-Varianten</h1>
    <span class="spacer"></span>
    <a href={href.groups()}>Zu den Gruppen</a>
    <UserMenu />
  </div>

  {#if !session.user?.isAdmin}
    <p class="error">Dieser Bereich ist nur für Administratoren.</p>
  {:else}
    <p class="muted">Spielleiter können diese Varianten als Ausgangspunkt für die Fertigkeiten ihrer Gruppe übernehmen.</p>
    {#if task.error}<p class="error">{task.error}</p>{/if}

    {#if draft}
      <form class="card" onsubmit={save}>
        <h2>{draft.id === null ? 'Neue Variante' : 'Variante bearbeiten'}</h2>
        <label>
          Name
          <input bind:value={draft.name} required maxlength={MAX_PRESET_NAME_LENGTH} />
        </label>
        <label>
          Beschreibung / Quelle
          <input bind:value={draft.description} maxlength={MAX_PRESET_DESCRIPTION_LENGTH} />
        </label>
        <strong>Fertigkeiten</strong>
        <SkillListEditor bind:skills={draft.skills} />
        <div class="row actions">
          <button class="primary" disabled={task.busy}>Speichern</button>
          <button type="button" onclick={() => (draft = null)}>Abbrechen</button>
        </div>
      </form>
    {:else}
      <p><button class="primary" onclick={() => edit()}>Neue Variante</button></p>
      <ul class="list card">
        {#each presets as preset (preset.id)}
          <li>
            <div class="info">
              <strong>{preset.name}</strong> <span class="badge">{preset.skills.length}</span>
              {#if preset.description}<div class="muted">{preset.description}</div>{/if}
              <div class="muted">{preset.skills.join(' · ')}</div>
            </div>
            <button onclick={() => edit(preset)}>Bearbeiten</button>
            <button class="danger" onclick={() => remove(preset)}>Löschen</button>
          </li>
        {:else}
          <li class="muted">Keine Varianten vorhanden.</li>
        {/each}
      </ul>
    {/if}
  {/if}
</main>

<style>
  .info { flex: 1; min-width: 12rem; }
  .actions { margin-top: 1rem; }
</style>
