<script lang="ts">
  import {
    MAX_STORAGE_DISPLAY_NAME_LENGTH,
    STORAGE_PROVIDER_LABELS,
    type StorageConnection,
    type StorageProviderInfo,
    type StorageProviderType,
  } from '@pnp/shared';
  import { api } from '../api.ts';
  import { createTask } from '../task.svelte.ts';
  import DriveFolderPicker from './DriveFolderPicker.svelte';
  import S3ConnectionForm from './S3ConnectionForm.svelte';
  import { t, type StorageMessageKey } from './messages.ts';

  let {
    connectedId,
    oauthError,
    onParamsHandled,
  }: {
    /** Rückkehr aus der Google-Anmeldung: ID der neuen Verbindung, für die jetzt der Ordner gewählt wird */
    connectedId?: number;
    /** Rückkehr aus der Google-Anmeldung mit Fehler */
    oauthError?: string;
    /** Parameter verarbeitet (die Seite entfernt sie dann aus der Adresse) */
    onParamsHandled?: () => void;
  } = $props();

  let providers = $state<StorageProviderInfo[]>([]);
  let connections = $state<StorageConnection[] | null>(null);
  /** Ergebnis der letzten Aktion je Verbindung (Testen, Entfernen fehlgeschlagen) */
  let results = $state<Record<number, { ok: boolean; text: string }>>({});
  let busyIds = $state<Record<number, 'test' | 'remove'>>({});
  let notice = $state('');
  // Fehler der Google-Anmeldung einmalig aus der Adresse übernehmen; danach lebt er nur hier
  // svelte-ignore state_referenced_locally
  let driveError = $state(oauthError ?? '');
  let folderPickFor = $state<number | null>(null);
  let adding = $state(false);
  let provider = $state<StorageProviderType | null>(null);
  let driveName = $state('');
  let redirecting = $state(false);

  const loading = createTask();

  const providerLabel = (type: string) =>
    (STORAGE_PROVIDER_LABELS as Record<string, string>)[type] ? t(`provider.${type}` as StorageMessageKey) : type;
  const statusLabel = (status: StorageConnection['status']) => t(`status.${status}`);
  const pickConnection = $derived(connections?.find((c) => c.id === folderPickFor) ?? null);

  const needsFolder = (c: StorageConnection) => c.providerType === 'google_drive' && !c.config.folderId;

  /** Nicht geheime Angaben zur Verbindung; Zugangsdaten liefert der Server nie, sie erscheinen nur maskiert */
  function details(c: StorageConnection): { label: string; value: string }[] {
    const str = (v: unknown) => (typeof v === 'string' && v ? v : '');
    const rows: { label: string; value: string }[] = [];
    if (c.providerType === 's3') {
      rows.push({ label: t('detail.bucket'), value: str(c.config.bucket) });
      rows.push({ label: t('detail.region'), value: str(c.config.region) });
      if (str(c.config.endpoint)) rows.push({ label: t('detail.endpoint'), value: str(c.config.endpoint) });
      if (str(c.config.prefix)) rows.push({ label: t('detail.prefix'), value: str(c.config.prefix) });
    } else if (c.providerType === 'google_drive') {
      if (str(c.config.accountEmail)) rows.push({ label: t('detail.account'), value: str(c.config.accountEmail) });
      rows.push({ label: t('detail.folder'), value: str(c.config.folderName) || t('noFolder') });
    }
    return rows.filter((r) => r.value);
  }

  const load = () =>
    loading.run(async () => {
      const [p, c] = await Promise.all([api.storageProviders(), api.storageConnections()]);
      providers = p;
      connections = c;
    });

  // Laden; nach der Rückkehr von Google gleich die Ordnerauswahl der neuen Verbindung öffnen
  // svelte-ignore state_referenced_locally
  const returnedFrom = connectedId;
  load().then(() => {
    if (returnedFrom !== undefined) {
      const created = connections?.find((c) => c.id === returnedFrom);
      if (created && needsFolder(created)) {
        folderPickFor = created.id;
        notice = t('drive.connected');
      } else if (created) {
        notice = t('added', { name: created.displayName });
      } else if (connections) {
        driveError = t('drive.unknownConnection');
      }
    }
    if (returnedFrom !== undefined || oauthError) onParamsHandled?.();
  });

  function replace(updated: StorageConnection) {
    connections = connections?.map((c) => (c.id === updated.id ? updated : c)) ?? [updated];
  }

  async function test(c: StorageConnection) {
    busyIds[c.id] = 'test';
    delete results[c.id];
    notice = '';
    try {
      replace(await api.testStorageConnection(c.id));
      results[c.id] = { ok: true, text: t('testOk') };
    } catch (err) {
      results[c.id] = { ok: false, text: t('testFailed', { error: (err as Error).message }) };
      // Der Server hat den neuen Status (Fehler/getrennt) gespeichert – Liste auffrischen, Fehler dabei egal
      api.storageConnections().then((list) => (connections = list), () => {});
    } finally {
      delete busyIds[c.id];
    }
  }

  async function remove(c: StorageConnection) {
    if (!confirm(t('removeConfirm', { name: c.displayName }))) return;
    busyIds[c.id] = 'remove';
    delete results[c.id];
    notice = '';
    try {
      await api.deleteStorageConnection(c.id);
      connections = connections?.filter((x) => x.id !== c.id) ?? null;
      if (folderPickFor === c.id) folderPickFor = null;
      notice = t('removed', { name: c.displayName });
    } catch (err) {
      results[c.id] = { ok: false, text: t('removeFailed', { error: (err as Error).message }) };
    } finally {
      delete busyIds[c.id];
    }
  }

  function startAdding() {
    adding = true;
    notice = '';
    driveError = '';
    // Gibt es nur einen Anbieter, gleich dessen Formular zeigen
    provider = providers.length === 1 ? providers[0]!.type : null;
  }

  function stopAdding() {
    adding = false;
    provider = null;
    driveName = '';
  }

  function created(c: StorageConnection) {
    connections = [...(connections ?? []), c];
    stopAdding();
    notice = t('added', { name: c.displayName });
  }

  async function connectDrive() {
    redirecting = true;
    try {
      await api.connectGoogleDrive(driveName.trim() || undefined);
    } catch (err) {
      redirecting = false;
      driveError = (err as Error).message;
    }
  }

  function folderChosen(c: StorageConnection) {
    replace(c);
    folderPickFor = null;
    notice = t('folder.saved', { folder: String(c.config.folderName ?? '') });
  }
</script>

<section class="card storage" aria-labelledby="storage-title">
  <h2 id="storage-title">{t('title')}</h2>
  <p class="muted">{t('intro')}</p>

  {#if driveError}
    <p class="error" role="alert">{t('drive.oauthError', { error: driveError })}</p>
  {/if}
  <p role="status" class="notice">
    {#if notice}<span class="success">{notice}</span>{/if}
  </p>

  {#if loading.busy && !connections}
    <p class="muted" role="status">{t('loading')}</p>
  {:else if loading.error && !connections}
    <div role="alert">
      <p class="error">{t('loadError', { error: loading.error })}</p>
      <button onclick={load}>{t('retry')}</button>
    </div>
  {:else if connections}
    {#if connections.length === 0}
      <p class="empty">{t('empty')}</p>
    {:else}
      <ul class="connections" aria-label={t('listLabel')}>
        {#each connections as c (c.id)}
          {@const busy = busyIds[c.id]}
          {@const result = results[c.id]}
          <li class="connection" aria-label={c.displayName}>
            <div class="head">
              <strong>{c.displayName}</strong>
              <span class="badge status-{c.status}" title={c.statusMessage || undefined}>{statusLabel(c.status)}</span>
            </div>
            <dl>
              <dt>{t('detail.type')}</dt>
              <dd>{providerLabel(c.providerType)}</dd>
              {#each details(c) as row (row.label)}
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              {/each}
              <dt>{t('detail.credentials')}</dt>
              <dd><span aria-hidden="true">{t('credentialsMasked')}</span> <span class="muted">({t('credentialsHint')})</span></dd>
            </dl>
            {#if c.status !== 'connected' && c.statusMessage && !(result && !result.ok)}
              <p class="error status-message">{c.statusMessage}</p>
            {/if}
            {#if c.status === 'disconnected'}
              <p class="muted">{t('disconnectedHint')}</p>
            {/if}
            <div class="row actions">
              <button onclick={() => test(c)} disabled={!!busy}>{busy === 'test' ? t('testing') : t('test')}</button>
              {#if needsFolder(c)}
                <button onclick={() => (folderPickFor = c.id)} disabled={!!busy || folderPickFor === c.id}>{t('chooseFolder')}</button>
              {/if}
              <button class="danger" onclick={() => remove(c)} disabled={!!busy}>
                {busy === 'remove' ? t('removing') : t('remove')}
              </button>
            </div>
            {#if result}
              <p class={result.ok ? 'success' : 'error'} role={result.ok ? 'status' : 'alert'}>{result.text}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if pickConnection}
      {#key pickConnection.id}
        <DriveFolderPicker connection={pickConnection} onDone={folderChosen} onCancel={() => (folderPickFor = null)} />
      {/key}
    {/if}

    {#if !adding}
      <div class="row">
        <button class="primary" onclick={startAdding}>{t('add')}</button>
      </div>
    {:else}
      <div class="card add">
        <h3>{t('add')}</h3>
        {#if providers.length === 0}
          <p class="muted">{t('noProviders')}</p>
        {:else}
          <fieldset class="providers">
            <legend>{t('providerLegend')}</legend>
            {#each providers as p (p.type)}
              <label class="option">
                <input type="radio" name="storage-provider" value={p.type} bind:group={provider} />
                {providerLabel(p.type)}
              </label>
            {/each}
          </fieldset>
        {/if}

        {#if provider === 's3'}
          <S3ConnectionForm onCreated={created} onCancel={stopAdding} />
        {:else if provider === 'google_drive'}
          <div class="drive">
            <p>{t('drive.text')}</p>
            <label>
              {t('drive.displayName')}
              <input bind:value={driveName} maxlength={MAX_STORAGE_DISPLAY_NAME_LENGTH} aria-describedby="drive-name-hint" />
            </label>
            <p class="muted hint" id="drive-name-hint">{t('drive.displayNameHint')}</p>
            <div class="row actions">
              <button class="primary" onclick={connectDrive} disabled={redirecting}>
                {redirecting ? t('drive.connecting') : t('drive.connect')}
              </button>
              <button onclick={stopAdding} disabled={redirecting}>{t('cancel')}</button>
            </div>
          </div>
        {:else}
          {#if provider}<p class="muted">{t('unsupportedProvider')}</p>{/if}
          <div class="row">
            <button onclick={stopAdding}>{t('cancel')}</button>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .storage { display: grid; gap: 0.75rem; }
  .storage h2 { margin: 0; font-size: 1.15rem; }
  .storage > p { margin: 0; }
  .notice:empty { display: none; }
  .connections { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
  .connection { border: var(--border); border-radius: var(--border-radius); padding: 0.75rem; display: grid; gap: 0.4rem; }
  .connection p { margin: 0; }
  .head { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .badge { font-size: 0.8em; padding: 0.1rem 0.5rem; border-radius: var(--radius-pill); border: var(--border-width) var(--border-style) currentColor; }
  .status-connected { color: var(--color-accent); }
  .status-error, .status-disconnected { color: var(--color-danger); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.15rem 0.75rem; margin: 0; font-size: 0.9em; }
  dt { color: var(--color-text-muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .actions { gap: 0.5rem; flex-wrap: wrap; }
  .add { display: grid; gap: 0.75rem; }
  .add h3 { margin: 0; font-size: 1.05rem; }
  .providers { border: none; padding: 0; margin: 0; display: flex; gap: 1rem; flex-wrap: wrap; }
  .providers legend { font-weight: 600; padding: 0; margin-bottom: 0.25rem; }
  .option { display: flex; gap: 0.4rem; align-items: center; font-weight: 400; margin: 0; }
  .option input { width: auto; margin: 0; }
  .drive { display: grid; gap: 0.5rem; }
  .drive p { margin: 0; }
  .drive label { display: grid; gap: 0.2rem; margin: 0; }
  .hint { font-weight: 400; }
  .success { color: var(--color-accent); font-weight: 600; }
</style>
