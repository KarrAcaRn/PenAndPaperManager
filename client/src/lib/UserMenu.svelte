<script lang="ts">
  import { logout, session } from './session.svelte.ts';
</script>

<span class="muted">{session.user?.email}</span>
<button onclick={logout}>Logout</button>
