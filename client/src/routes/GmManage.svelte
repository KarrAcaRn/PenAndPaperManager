<script lang="ts">
  import { MAX_EMAIL_LENGTH, ROLE_LABELS, type Group, type Member } from '@pnp/shared';
  import { api } from '../lib/api.ts';
  import { href, navigate } from '../lib/router.svelte.ts';
  import { reloadGroups, session } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';

  let { group }: { group: Group } = $props();

  let members = $state<Member[]>([]);
  let email = $state('');
  const task = createTask();

  const gmCount = $derived(members.filter((m) => m.role === 'gm').length);
  const isLastGm = (m: Member) => m.role === 'gm' && gmCount <= 1;

  async function load() {
    members = await api.members(group.id);
  }
  task.run(load);

  const run = (action: () => Promise<unknown>, affectsMe = false) =>
    task.run(async () => {
      await action();
      if (affectsMe) {
        // Eigene Rolle/Mitgliedschaft hat sich geändert - dieser Bereich ist dann nicht mehr zugänglich
        await reloadGroups();
        navigate(session.groups.some((g) => g.id === group.id) ? href.group(group.id) : href.groups());
        return;
      }
      await load();
    });

  function invite(event: SubmitEvent) {
    event.preventDefault();
    run(async () => {
      await api.invite(group.id, email);
      email = '';
    });
  }

  function demote(m: Member) {
    const me = m.userId === session.user?.id;
    if (me && !confirm('Du gibst damit deinen Spielleiter-Status ab. Fortfahren?')) return;
    run(() => api.setRole(group.id, m.userId, 'player'), me);
  }

  function remove(m: Member) {
    const me = m.userId === session.user?.id;
    if (!confirm(me ? 'Gruppe wirklich verlassen?' : `${m.email} aus der Gruppe entfernen?`)) return;
    run(() => api.removeMember(group.id, m.userId), me);
  }
</script>

<h2>Mitglieder</h2>
{#if task.error}<p class="error">{task.error}</p>{/if}

<ul class="list card">
  {#each members as m (m.userId)}
    <li>
      <span class="title">{m.email}</span>
      {#if m.userId === session.user?.id}<span class="muted">(du)</span>{/if}
      <span class="badge {m.role}">{ROLE_LABELS[m.role]}</span>
      <span class="spacer"></span>
      {#if m.role === 'player'}
        <button onclick={() => run(() => api.setRole(group.id, m.userId, 'gm'))}>Zum Spielleiter machen</button>
      {:else}
        <button disabled={isLastGm(m)} title={isLastGm(m) ? 'Die Gruppe braucht mindestens einen Spielleiter' : ''} onclick={() => demote(m)}>
          Zum Spieler machen
        </button>
      {/if}
      <button class="danger" disabled={isLastGm(m)} onclick={() => remove(m)}>
        {m.userId === session.user?.id ? 'Verlassen' : 'Entfernen'}
      </button>
    </li>
  {/each}
</ul>

<h2>Einladen</h2>
<form class="row card" onsubmit={invite}>
  <input type="email" bind:value={email} required maxlength={MAX_EMAIL_LENGTH} placeholder="E-Mail-Adresse des Spielers" />
  <button class="primary">Einladen</button>
</form>
<p class="muted">Eingeladene werden als Spieler hinzugefügt und sehen die Gruppe nach ihrem Login.</p>

<style>
  form input { flex: 1; width: auto; }
  .title { font-weight: 600; }
</style>
