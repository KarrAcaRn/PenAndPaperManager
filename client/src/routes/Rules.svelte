<script lang="ts">
  import { MAX_RULE_HITS, MAX_RULE_QUERY_LENGTH, type RuleHit, type Rulebook } from '@pnp/shared';
  import { api, rulebookPdfUrl } from '../lib/api.ts';
  import { createTask } from '../lib/task.svelte.ts';

  const SEARCH_DELAY_MS = 250;

  let rulebooks = $state<Rulebook[]>([]);
  let selectedId = $state<number | null>(null);
  let loaded = $state(false);
  let query = $state('');
  /** null: keine Suche aktiv, links steht das Inhaltsverzeichnis */
  let hits = $state<RuleHit[] | null>(null);
  /** Angezeigte Seite; jump zählt jeden Sprung, damit auch ein erneuter Klick auf dieselbe Seite dorthin springt */
  let view = $state({ page: 1, jump: 0 });
  /** Fehler der letzten Suche - eigener Zustand statt createTask, damit veraltete Anfragen ihn nicht setzen */
  let searchError = $state('');
  const task = createTask();

  const book = $derived(rulebooks.find((b) => b.id === selectedId));

  task.run(async () => {
    rulebooks = await api.rulebooks();
    selectedId = rulebooks[0]?.id ?? null;
    loaded = true;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let searchSeq = 0;

  function search() {
    clearTimeout(timer);
    const q = query.trim();
    const seq = ++searchSeq;
    searchError = '';
    if (!q || selectedId === null) {
      hits = null;
      return;
    }
    // Ältere, langsamere Antworten dürfen neuere nicht überschreiben - weder Treffer noch Fehler
    api.searchRules(q, selectedId).then(
      (result) => {
        if (seq === searchSeq) hits = result;
      },
      (err: Error) => {
        if (seq === searchSeq) searchError = err.message;
      },
    );
  }

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(search, SEARCH_DELAY_MS);
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    search();
  }

  function selectBook(id: number) {
    selectedId = id;
    view = { page: 1, jump: view.jump + 1 };
    search();
  }

  const show = (page: number) => (view = { page, jump: view.jump + 1 });

  $effect(() => () => clearTimeout(timer));
</script>

{#if task.error}
  <p class="error">{task.error}</p>
{:else if loaded && !book}
  <div class="card">
    <h1>Regelwerk</h1>
    <p class="muted">
      Es ist noch kein Regelwerk eingespielt. Ein Administrator kann eines auf dem Server mit
      <code>npm run import-rulebook -- &lt;PDF-Datei oder URL&gt; "Titel"</code> hinzufügen.
    </p>
  </div>
{:else if book}
  <div class="split">
    <aside class="card frame no-print">
      {#if rulebooks.length > 1}
        <label>
          Regelwerk
          <select value={selectedId} onchange={(e) => selectBook(Number(e.currentTarget.value))}>
            {#each rulebooks as rb (rb.id)}<option value={rb.id}>{rb.title}</option>{/each}
          </select>
        </label>
      {/if}
      <form role="search" onsubmit={onSubmit}>
        <input
          type="search"
          placeholder="Im Regelwerk suchen …"
          aria-label="Im Regelwerk suchen"
          maxlength={MAX_RULE_QUERY_LENGTH}
          bind:value={query}
          oninput={onInput}
        />
      </form>
      {#if searchError}<p class="error">{searchError}</p>{/if}

      {#if hits}
        <p class="muted">{hits.length === 0
            ? 'Keine Treffer.'
            : hits.length === 1
              ? '1 Treffer'
              : hits.length >= MAX_RULE_HITS
                ? `Die ${hits.length} besten Treffer – für weniger Ergebnisse weitere Wörter eingeben.`
                : `${hits.length} Treffer`}</p>
        <ul class="entries" aria-label="Suchergebnisse">
          {#each hits as hit (hit.page)}
            <li>
              <button type="button" class="entry" class:current={hit.page === view.page} onclick={() => show(hit.page)}>
                <span class="head"><strong>S. {hit.label}</strong> <span class="muted">{hit.chapter}</span></span>
                <span class="snippet">
                  {#each hit.snippet as part, i (i)}{#if part.mark}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <ul class="entries" aria-label="Inhaltsverzeichnis">
          {#each book.chapters as chapter, i (i)}
            <li style:padding-left="{chapter.level * 0.9}rem">
              <button type="button" class="entry toc" class:chapter={chapter.level === 0} onclick={() => show(chapter.page)}>
                <span>{chapter.title}</span>
                <span class="muted">{chapter.label}</span>
              </button>
            </li>
          {:else}
            <li class="muted">Kein Inhaltsverzeichnis im PDF – die Suche funktioniert trotzdem.</li>
          {/each}
        </ul>
      {/if}
    </aside>

    <section class="pane">
      <div class="row">
        <h1>{book.title}</h1>
        <span class="spacer"></span>
        <a href={rulebookPdfUrl(book, view.page)} target="_blank" rel="noopener">PDF in neuem Tab öffnen</a>
      </div>
      {#key `${book.id}:${view.jump}`}
        <iframe class="pdf" title={book.title} src={rulebookPdfUrl(book, view.page)}></iframe>
      {/key}
    </section>
  </div>
{:else}
  <p class="muted">Lade …</p>
{/if}

<style>
  h1 { margin: 0 0 0.75rem; font-size: 1.4rem; }
  form { margin-bottom: 0.5rem; }
  .entries { list-style: none; margin: 0; padding: 0; }
  .entry {
    display: flex; flex-direction: column; align-items: stretch; gap: 0.1rem; width: 100%;
    text-align: left; border: none; background: none; padding: 0.35rem 0.4rem; border-radius: var(--border-radius);
    color: var(--color-text); font: inherit;
  }
  .entry:hover { background: var(--color-surface-muted); }
  .entry.current { background: var(--color-surface-muted); box-shadow: inset var(--border-width-strong) 0 var(--color-accent); }
  .entry.toc { flex-direction: row; justify-content: space-between; gap: 0.5rem; }
  .entry.chapter { font-weight: 600; margin-top: 0.3rem; }
  .entries > li + li .entry:not(.toc) { border-top: var(--border); border-radius: 0; }
  .head { font-size: 0.9rem; }
  .snippet { font-size: 0.9rem; overflow-wrap: anywhere; }
  mark { background: var(--color-highlight); color: inherit; border-radius: var(--border-radius-small); }
  .pdf { display: block; width: 100%; height: calc(100vh - 10rem); min-height: 30rem; border: var(--border); border-radius: var(--border-radius); background: var(--color-surface); }
</style>
