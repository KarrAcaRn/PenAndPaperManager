<script lang="ts">
  import { MAX_EMAIL_LENGTH } from '@pnp/shared';
  import { login } from '../lib/session.svelte.ts';
  import { createTask } from '../lib/task.svelte.ts';

  let email = $state('');
  const task = createTask();

  function submit(event: SubmitEvent) {
    event.preventDefault();
    task.run(() => login(email));
  }
</script>

<main class="narrow">
  <h1>Pen &amp; Paper Manager</h1>
  <p class="muted">Kampagnenverwaltung für FATE-Runden</p>
  <form class="card" onsubmit={submit}>
    <label>
      E-Mail-Adresse
      <input type="email" bind:value={email} required maxlength={MAX_EMAIL_LENGTH} autocomplete="email" placeholder="du@example.org" />
    </label>
    {#if task.error}<p class="error">{task.error}</p>{/if}
    <button class="primary" disabled={task.busy}>Einloggen</button>
    <p class="muted">Testphase: Login ohne Passwort.</p>
  </form>
</main>

<style>
  .narrow { max-width: 26rem; margin-top: 10vh; }
</style>
