<script lang="ts">
  import type { Group, SkillInput, SkillPreset } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import SkillListEditor from '../lib/SkillListEditor.svelte';

  let { group }: { group: Group } = $props();

  let skills = $state<SkillInput[]>([]);
  let presets = $state<SkillPreset[]>([]);
  let presetId = $state<number | null>(null);
  let dirty = $state(false);
  let loaded = $state(false);
  const task = createTask();

  task.run(async () => {
    [skills, presets] = await Promise.all([api.skills(group.id), api.presets()]);
    presetId = presets[0]?.id ?? null;
    loaded = true;
  });

  const save = () =>
    task.run(async () => {
      skills = await api.saveSkills(group.id, skills);
      dirty = false;
    });

  function applyPreset() {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    if (skills.length > 0 && !confirm(`Die aktuelle Liste durch „${preset.name}“ ersetzen? Werte gleichnamiger Fertigkeiten bleiben erhalten.`)) return;
    task.run(async () => {
      skills = await api.applyPreset(group.id, preset.id);
      dirty = false;
    });
  }
</script>

<h2>Fertigkeiten dieser Kampagne</h2>
<p class="muted">
  Diese Liste erscheint auf allen FATE-Bögen der Gruppe. Umbenannte Fertigkeiten behalten ihre Werte; gelöschte verschwinden von den Bögen.
</p>
{#if task.error}<p class="error">{task.error}</p>{/if}

{#if loaded}
  <div class="card">
    <SkillListEditor bind:skills onchange={() => (dirty = true)} />
    <div class="row actions">
      <button class="primary" disabled={!dirty || task.busy} onclick={save}>Speichern</button>
      {#if dirty}<span class="muted">Ungespeicherte Änderungen</span>{/if}
    </div>
  </div>

  <h2>Variante laden</h2>
  {#if presets.length === 0}
    <p class="muted">Es sind keine Varianten hinterlegt.</p>
  {:else}
    <div class="card">
      <div class="row">
        <select bind:value={presetId} aria-label="Variante">
          {#each presets as preset (preset.id)}
            <option value={preset.id}>{preset.name} ({preset.skills.length})</option>
          {/each}
        </select>
        <button disabled={task.busy} onclick={applyPreset}>Übernehmen</button>
      </div>
      {#each presets.filter((p) => p.id === presetId) as preset}
        {#if preset.description}<p class="muted">{preset.description}</p>{/if}
        <p>{preset.skills.join(' · ')}</p>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .actions { margin-top: 1rem; }
  select { flex: 1; width: auto; }
</style>
