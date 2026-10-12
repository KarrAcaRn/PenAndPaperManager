<script lang="ts">
  import { FRAME_VARIANTS, applyFrameVariant, storedFrameVariant, type FrameVariant } from './frameVariants.ts';

  // VORÜBERGEHEND, siehe frameVariants.ts
  let variant = $state<FrameVariant>(storedFrameVariant());
  $effect(() => applyFrameVariant(variant));
</script>

<div class="variant-bar no-print">
  <label>
    Rahmen (Test):
    <select bind:value={variant}>
      {#each FRAME_VARIANTS as option (option.id)}<option value={option.id}>{option.label}</option>{/each}
    </select>
  </label>
</div>

<style>
  .variant-bar { max-width: 90rem; margin: 0 auto; padding: 0.5rem 1rem 0; display: flex; justify-content: flex-end; }
  label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85em; color: var(--muted); }
  select { width: auto; }
</style>
