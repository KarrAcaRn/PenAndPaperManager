<script lang="ts">
  import { loadSession, session } from './lib/session.svelte.ts';
  import { href, navigate, router, type Route } from './lib/router.svelte.ts';
  import { createTask } from './lib/task.svelte.ts';
  import Login from './routes/Login.svelte';
  import GroupSelect from './routes/GroupSelect.svelte';
  import GroupLayout from './routes/GroupLayout.svelte';
  import Admin from './routes/Admin.svelte';
  import Settings from './routes/Settings.svelte';
  import Soundboard from './routes/Soundboard.svelte';
  import NoticeBar from './lib/NoticeBar.svelte';

  const loading = createTask();
  loading.run(loadSession);

  /** Seiten, die auch ohne Login erreichbar sind (das Soundboard mit den Standard-Sounds) */
  const isPublic = (route: Route) => route.name === 'sounds';

  // Ohne Login geht es zu #/login (die URL merkt sich die angefragte Seite), nach dem Login dorthin zurück.
  $effect(() => {
    if (!session.ready) return;
    const route = router.route;
    if (!session.user && route.name !== 'login' && !isPublic(route)) navigate(href.login(location.hash));
    else if (session.user && route.name === 'login') navigate(route.next);
  });
</script>

{#if loading.error}
  <main><p class="error">Server nicht erreichbar: {loading.error}</p></main>
{:else if !session.ready}
  <main><p class="muted">Lade …</p></main>
{:else if router.route.name === 'sounds'}
  <!-- mit und ohne Login; bei An-/Abmeldung neu aufbauen, damit die eigenen Speicher (nicht mehr) erscheinen -->
  {#key session.user?.id}
    <Soundboard />
  {/key}
{:else if !session.user}
  <Login />
{:else if router.route.name === 'login'}
  <main><p class="muted">Lade …</p></main>
{:else}
  <!-- Hinweise überleben Seitenwechsel, daher hier statt in den einzelnen Seiten -->
  <NoticeBar />
  {#if router.route.name === 'groups'}
    <GroupSelect />
  {:else if router.route.name === 'admin'}
    <Admin />
  {:else if router.route.name === 'settings'}
    <Settings />
  {:else}
    <GroupLayout route={router.route} />
  {/if}
{/if}
