<script lang="ts">
  import { FRAME_SIZES, applyFrameSize, storedFrameSize, type FrameSize } from './frameSizes.ts';

  // VORÜBERGEHEND, siehe frameSizes.ts
  let size = $state<FrameSize>(storedFrameSize());
  $effect(() => applyFrameSize(size));
</script>

<div class="size-bar no-print">
  <label>
    Rahmengröße (Test):
    <select bind:value={size}>
      {#each FRAME_SIZES as option (option)}<option value={option}>{option} %</option>{/each}
    </select>
  </label>
</div>

<style>
  .size-bar { max-width: 90rem; margin: 0 auto; padding: 0.5rem 1rem 0; display: flex; justify-content: flex-end; }
  label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85em; color: var(--muted); }
  select { width: auto; }
</style>
