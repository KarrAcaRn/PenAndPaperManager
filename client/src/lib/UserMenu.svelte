<script lang="ts">
  import { href } from './router.svelte.ts';
  import { logout, session } from './session.svelte.ts';
</script>

{#if session.user?.isAdmin}<a class="no-print" href={href.admin()}>Admin</a>{/if}
<a class="no-print" href={href.sounds()}>Soundboard</a>
<span class="muted">{session.user?.email}</span>
<button onclick={logout}>Logout</button>
