<script lang="ts">
  import { MAX_SKILLS, MAX_SKILL_NAME_LENGTH, type SkillInput } from '@pnp/shared';

  // Wird vom SL-Bereich (Fertigkeiten der Gruppe) und vom Admin-Bereich (Varianten) genutzt.
  let { skills = $bindable(), onchange = () => {} }: { skills: SkillInput[]; onchange?: () => void } = $props();

  let newName = $state('');

  function update(next: SkillInput[]) {
    skills = next;
    onchange();
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    newName = '';
    update([...skills, { name }]);
  }

  // Bewusst kein <form>: der Editor steckt im Admin-Bereich selbst in einem Formular.
  function addOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  }

  const remove = (index: number) => update(skills.filter((_, i) => i !== index));

  function move(index: number, by: -1 | 1) {
    const next = [...skills];
    next.splice(index + by, 0, ...next.splice(index, 1));
    update(next);
  }
</script>

{#if skills.length === 0}
  <p class="muted">Noch keine Fertigkeiten.</p>
{:else}
  <ol class="list">
    {#each skills as skill, index}
      <li>
        <input bind:value={skill.name} oninput={onchange} maxlength={MAX_SKILL_NAME_LENGTH} aria-label="Fertigkeit {index + 1}" />
        <button type="button" disabled={index === 0} onclick={() => move(index, -1)} aria-label="{skill.name} nach oben">↑</button>
        <button type="button" disabled={index === skills.length - 1} onclick={() => move(index, 1)} aria-label="{skill.name} nach unten">↓</button>
        <button type="button" class="danger" onclick={() => remove(index)} aria-label="{skill.name} entfernen">✕</button>
      </li>
    {/each}
  </ol>
{/if}

<div class="row add">
  <input
    bind:value={newName}
    onkeydown={addOnEnter}
    maxlength={MAX_SKILL_NAME_LENGTH}
    placeholder="Neue Fertigkeit"
    disabled={skills.length >= MAX_SKILLS}
  />
  <button type="button" disabled={skills.length >= MAX_SKILLS} onclick={add}>Hinzufügen</button>
</div>

<style>
  ol { list-style: none; margin: 0 0 0.75rem; padding: 0; }
  li, .add { flex-wrap: nowrap; }
  input { flex: 1; width: auto; min-width: 0; }
</style>
