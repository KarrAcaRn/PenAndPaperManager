<script lang="ts">
  import { MAX_STORAGE_FILE_NAME_LENGTH, type StorageConnection, type StorageFolder } from '@pnp/shared';
  import { api } from '../api.ts';
  import { createTask } from '../task.svelte.ts';
  import { t } from './messages.ts';

  let {
    connection,
    onDone,
    onCancel,
  }: { connection: StorageConnection; onDone: (connection: StorageConnection) => void; onCancel: () => void } = $props();

  /** '' = neuen Ordner anlegen, sonst die ID eines vorhandenen */
  let choice = $state('');
  let newName = $state(t('folder.defaultName'));
  let folders = $state<StorageFolder[]>([]);
  let nextCursor = $state<string | null>(null);

  const loading = createTask();
  const saving = createTask();

  const load = (cursor?: string) =>
    loading.run(async () => {
      const page = await api.driveFolders(connection.id, cursor);
      folders = cursor ? [...folders, ...page.folders] : page.folders;
      nextCursor = page.nextCursor;
    });
  load();

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    let updated: StorageConnection | null = null;
    const ok = await saving.run(async () => {
      updated = await api.chooseDriveFolder(connection.id, choice ? { folderId: choice } : { name: newName.trim() });
    });
    if (ok && updated) onDone(updated);
  }
</script>

<form class="card picker" onsubmit={submit} aria-busy={saving.busy} aria-labelledby="folder-title-{connection.id}">
  <h3 id="folder-title-{connection.id}">{t('folder.title')}</h3>
  <p class="muted">{t('folder.for', { name: connection.displayName })}</p>

  <label class="option">
    <input type="radio" name="folder-{connection.id}" value="" bind:group={choice} />
    {t('folder.create')}
  </label>
  {#if choice === ''}
    <label class="new-name">
      {t('folder.newName')}
      <input bind:value={newName} required maxlength={MAX_STORAGE_FILE_NAME_LENGTH} />
    </label>
  {/if}

  <fieldset>
    <legend>{t('folder.existing')}</legend>
    {#if loading.error}
      <p class="error" role="alert">{t('folder.loadError', { error: loading.error })}</p>
      <button type="button" onclick={() => load()}>{t('retry')}</button>
    {:else if !loading.busy && folders.length === 0}
      <p class="muted">{t('folder.none')}</p>
    {/if}
    {#each folders as folder (folder.id)}
      <label class="option">
        <input type="radio" name="folder-{connection.id}" value={folder.id} bind:group={choice} />
        {folder.name}
      </label>
    {/each}
    {#if loading.busy}
      <p class="muted" role="status">{t('folder.loading')}</p>
    {:else if nextCursor && !loading.error}
      <button type="button" onclick={() => load(nextCursor ?? undefined)}>{t('folder.more')}</button>
    {/if}
  </fieldset>

  {#if saving.error}
    <p class="error" role="alert">{t('folder.failed', { error: saving.error })}</p>
  {/if}

  <div class="row actions">
    <button class="primary" disabled={saving.busy || (choice === '' && !newName.trim())}>
      {saving.busy ? t('folder.submitting') : t('folder.submit')}
    </button>
    <button type="button" onclick={onCancel} disabled={saving.busy}>{t('folder.later')}</button>
  </div>
</form>

<style>
  .picker { display: grid; gap: 0.5rem; }
  .picker h3 { margin: 0; font-size: 1.05rem; }
  .picker p { margin: 0; }
  fieldset { border: none; padding: 0; margin: 0; display: grid; gap: 0.25rem; }
  legend { font-weight: 600; padding: 0; margin-bottom: 0.25rem; }
  .option { display: flex; gap: 0.5rem; align-items: center; font-weight: 400; margin: 0; }
  .option input { width: auto; margin: 0; }
  .new-name { display: grid; gap: 0.2rem; margin: 0 0 0 1.5rem; }
  .actions { gap: 0.5rem; }
</style>
