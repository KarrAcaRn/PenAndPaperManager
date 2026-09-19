<script lang="ts">
  import { MAX_GROUP_NAME_LENGTH, ROLE_LABELS } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { reloadGroups, session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';

  let name = $state('');
  // Ohne Gruppe wird das Anlegen direkt angeboten
  let showCreate = $state(session.groups.length === 0);
  const task = createTask();

  function create(event: SubmitEvent) {
    event.preventDefault();
    task.run(async () => {
      const group = await api.createGroup(name);
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
      <p class="muted">Du wirst Spielleiter dieser Gruppe.</p>
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
