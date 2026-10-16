<script lang="ts">
  import { href } from '../lib/router.svelte.ts';
  import UserMenu from '../lib/UserMenu.svelte';
</script>

<!-- Platzhalter: die eigentlichen Benutzereinstellungen folgen in einem eigenen Schritt -->
<main>
  <div class="row">
    <h1>Einstellungen</h1>
    <span class="spacer"></span>
    <a href={href.groups()}>Zu den Gruppen</a>
    <UserMenu />
  </div>

  <p class="muted">Hier kannst du bald deine persönlichen Einstellungen festlegen.</p>
</main>
