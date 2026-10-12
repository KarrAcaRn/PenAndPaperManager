<script lang="ts">
  import { loadSession, session } from './lib/session.svelte.ts';
  import { router } from './lib/router.svelte.ts';
  import { createTask } from './lib/task.svelte.ts';
  import Login from './routes/Login.svelte';
  import GroupSelect from './routes/GroupSelect.svelte';
  import GroupLayout from './routes/GroupLayout.svelte';
  import Admin from './routes/Admin.svelte';
  import NoticeBar from './lib/NoticeBar.svelte';
  import FrameVariantPicker from './lib/FrameVariantPicker.svelte';

  const loading = createTask();
  loading.run(loadSession);
</script>

<!-- VORÜBERGEHEND: Auswahl der Rahmen-Variante zum Ausprobieren -->
<FrameVariantPicker />

{#if loading.error}
  <main><p class="error">Server nicht erreichbar: {loading.error}</p></main>
{:else if !session.ready}
  <main><p class="muted">Lade …</p></main>
{:else if !session.user}
  <Login />
{:else}
  <!-- Hinweise überleben Seitenwechsel, daher hier statt in den einzelnen Seiten -->
  <NoticeBar />
  {#if router.route.name === 'groups'}
    <GroupSelect />
  {:else if router.route.name === 'admin'}
    <Admin />
  {:else}
    <GroupLayout route={router.route} />
  {/if}
{/if}
