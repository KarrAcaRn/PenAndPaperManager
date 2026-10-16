<script lang="ts">
  import { MAX_STORAGE_DISPLAY_NAME_LENGTH, MAX_STORAGE_FOLDER_LENGTH, type StorageConnection } from '@pnp/shared';
  import { api } from '../api.ts';
  import { createTask } from '../task.svelte.ts';
  import { t } from './messages.ts';

  let { onCreated, onCancel }: { onCreated: (connection: StorageConnection) => void; onCancel: () => void } = $props();

  /** Ausführliche Anleitung (IAM-Rechte, CORS je Anbieter) */
  const CORS_GUIDE_URL =
    'https://github.com/KarrAcaRn/PenAndPaperManager/blob/main/docs/soundboard-storage.md#cors-konfiguration-des-buckets';

  let displayName = $state('');
  let accessKeyId = $state('');
  let secretAccessKey = $state('');
  let bucket = $state('');
  let region = $state('');
  let endpoint = $state('');
  let prefix = $state('');

  const saving = createTask();

  const corsExample = JSON.stringify(
    [
      {
        AllowedOrigins: [location.origin],
        AllowedMethods: ['GET', 'HEAD', 'PUT'],
        AllowedHeaders: ['content-type', 'if-none-match'],
        ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
        MaxAgeSeconds: 3600,
      },
    ],
    null,
    2,
  );

  /** Der Server prüft die Verbindung (Auflisten, Testdatei schreiben/lesen/löschen) und speichert nur bei Erfolg. */
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    let created: StorageConnection | null = null;
    const ok = await saving.run(async () => {
      created = await api.createStorageConnection({
        providerType: 's3',
        displayName: displayName.trim() || t('s3.defaultName', { bucket: bucket.trim() }),
        config: { bucket: bucket.trim(), region: region.trim(), endpoint: endpoint.trim(), prefix: prefix.trim() },
        credentials: { accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() },
      });
    });
    if (ok && created) {
      // Secret nicht länger als nötig im Speicher halten
      secretAccessKey = '';
      accessKeyId = '';
      onCreated(created);
    }
  }
</script>

<form class="s3-form" onsubmit={submit} aria-busy={saving.busy} aria-label={t('provider.s3')}>
  <label>
    {t('s3.displayName')}
    <input bind:value={displayName} maxlength={MAX_STORAGE_DISPLAY_NAME_LENGTH} aria-describedby="s3-name-hint" />
  </label>
  <p class="muted hint" id="s3-name-hint">{t('s3.displayNameHint')}</p>

  <div class="grid">
    <label>
      {t('s3.accessKeyId')}
      <input bind:value={accessKeyId} required maxlength="128" autocomplete="off" spellcheck="false" />
    </label>
    <label>
      {t('s3.secretAccessKey')}
      <input
        type="password"
        bind:value={secretAccessKey}
        required
        maxlength="256"
        autocomplete="new-password"
        spellcheck="false"
        aria-describedby="s3-secret-hint"
      />
    </label>
  </div>
  <p class="muted hint" id="s3-secret-hint">{t('s3.secretHint')}</p>

  <div class="grid">
    <label>
      {t('s3.bucket')}
      <input bind:value={bucket} required maxlength="63" autocomplete="off" spellcheck="false" />
    </label>
    <label>
      {t('s3.region')}
      <input bind:value={region} maxlength="32" placeholder="eu-central-1" autocomplete="off" aria-describedby="s3-region-hint" />
      <span class="muted hint" id="s3-region-hint">{t('s3.regionHint')}</span>
    </label>
    <label>
      {t('s3.endpoint')}
      <input type="url" bind:value={endpoint} maxlength="255" placeholder="https://" autocomplete="off" aria-describedby="s3-endpoint-hint" />
      <span class="muted hint" id="s3-endpoint-hint">{t('s3.endpointHint')}</span>
    </label>
    <label>
      {t('s3.prefix')}
      <input bind:value={prefix} maxlength={MAX_STORAGE_FOLDER_LENGTH} autocomplete="off" aria-describedby="s3-prefix-hint" />
      <span class="muted hint" id="s3-prefix-hint">{t('s3.prefixHint')}</span>
    </label>
  </div>

  <details class="cors">
    <summary>{t('s3.corsTitle')}</summary>
    <p>{t('s3.corsText')}</p>
    <pre>{corsExample}</pre>
    <p><a href={CORS_GUIDE_URL} target="_blank" rel="noopener noreferrer">{t('s3.corsLink')}</a></p>
  </details>

  {#if saving.error}
    <p class="error" role="alert">{t('s3.failed', { error: saving.error })}</p>
  {/if}

  <div class="row actions">
    <button class="primary" disabled={saving.busy}>{saving.busy ? t('s3.submitting') : t('s3.submit')}</button>
    <button type="button" onclick={onCancel} disabled={saving.busy}>{t('cancel')}</button>
  </div>
</form>

<style>
  .s3-form { display: grid; gap: 0.5rem; }
  .s3-form label { display: grid; gap: 0.2rem; align-content: start; margin-bottom: 0; min-width: 0; }
  .grid { display: grid; gap: 0.5rem 1rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
  .hint { margin: 0; font-weight: 400; overflow-wrap: anywhere; }
  .cors pre { overflow-x: auto; background: var(--bg); padding: 0.5rem; border-radius: var(--radius); font-size: 0.85em; }
  .cors summary { cursor: pointer; font-weight: 600; }
  .actions { gap: 0.5rem; }
</style>
