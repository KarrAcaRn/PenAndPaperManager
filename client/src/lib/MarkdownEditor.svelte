<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { Markdown } from '@tiptap/markdown';
  import { TableKit } from '@tiptap/extension-table';
  import Image from '@tiptap/extension-image';
  import { TaskItem, TaskList } from '@tiptap/extension-list';
  import { Placeholder } from '@tiptap/extensions';

  let {
    value = $bindable(''),
    label,
    maxlength,
    placeholder = '',
  }: { value?: string; label: string; maxlength?: number; placeholder?: string } = $props();

  let element: HTMLDivElement;
  let editor = $state<Editor | null>(null);
  /** Markdown-Quelltext statt WYSIWYG anzeigen */
  let source = $state(false);
  /** Wird bei jeder Änderung von Inhalt oder Auswahl hochgezählt, damit die Werkzeugleiste den Zustand neu liest */
  let tick = $state(0);

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        // Unterstreichen gibt es in Markdown nicht
        StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
        TableKit,
        Image,
        TaskList,
        TaskItem.configure({
          nested: true,
          a11y: { checkboxLabel: (node) => `Erledigt: ${node.textContent || 'leerer Eintrag'}` },
        }),
        Placeholder.configure({ placeholder }),
        // Wie in der Anzeige (lib/markdown.ts): einfache Zeilenumbrüche bleiben Zeilenumbrüche
        Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      ],
      content: value,
      contentType: 'markdown',
      editorProps: {
        attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, class: 'markdown content' },
      },
      onUpdate: ({ editor }) => {
        value = editor.getMarkdown().trim();
      },
      onTransaction: () => tick++,
    });
  });

  onDestroy(() => editor?.destroy());

  function toggleSource() {
    // Beim Zurückwechseln den (evtl. von Hand geänderten) Quelltext übernehmen, ohne ihn neu zu formatieren
    if (source) editor?.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    source = !source;
  }

  const isActive = (name: string, attrs?: Record<string, unknown>) => {
    void tick;
    return editor?.isActive(name, attrs) ?? false;
  };
  const can = (check: (e: Editor) => boolean) => {
    void tick;
    return editor ? check(editor) : false;
  };
  const chain = () => editor!.chain().focus();

  function setLink() {
    const previous = editor!.getAttributes('link').href as string | undefined;
    const url = prompt('Link-Adresse (leer = Link entfernen):', previous ?? 'https://');
    if (url === null) return;
    if (url.trim() === '') chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  function insertImage() {
    const src = prompt('Bild-Adresse (URL):', 'https://');
    if (src?.trim()) chain().setImage({ src: src.trim() }).run();
  }

  type Tool = { label: string; text: string; style?: string; run: () => void; active?: () => boolean; enabled?: () => boolean };
  const tools: Tool[][] = [
    [
      { label: 'Fett', text: 'F', style: 'bold', run: () => chain().toggleBold().run(), active: () => isActive('bold') },
      { label: 'Kursiv', text: 'K', style: 'italic', run: () => chain().toggleItalic().run(), active: () => isActive('italic') },
      { label: 'Durchgestrichen', text: 'S', style: 'strike', run: () => chain().toggleStrike().run(), active: () => isActive('strike') },
      { label: 'Code', text: '</>', run: () => chain().toggleCode().run(), active: () => isActive('code') },
      { label: 'Link', text: '🔗', run: setLink, active: () => isActive('link') },
    ],
    ([1, 2, 3] as const).map((level) => ({
      label: `Überschrift ${level}`,
      text: `Ü${level}`,
      run: () => chain().toggleHeading({ level }).run(),
      active: () => isActive('heading', { level }),
    })),
    [
      { label: 'Aufzählung', text: '•', run: () => chain().toggleBulletList().run(), active: () => isActive('bulletList') },
      { label: 'Nummerierte Liste', text: '1.', run: () => chain().toggleOrderedList().run(), active: () => isActive('orderedList') },
      { label: 'Checkliste', text: '☑', run: () => chain().toggleTaskList().run(), active: () => isActive('taskList') },
      { label: 'Zitat', text: '❝', run: () => chain().toggleBlockquote().run(), active: () => isActive('blockquote') },
      { label: 'Codeblock', text: '{ }', run: () => chain().toggleCodeBlock().run(), active: () => isActive('codeBlock') },
    ],
    [
      { label: 'Trennlinie', text: '―', run: () => chain().setHorizontalRule().run() },
      { label: 'Tabelle', text: '▦', run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { label: 'Bild', text: '🖼', run: insertImage },
    ],
    [
      { label: 'Rückgängig', text: '↶', run: () => chain().undo().run(), enabled: () => can((e) => e.can().undo()) },
      { label: 'Wiederholen', text: '↷', run: () => chain().redo().run(), enabled: () => can((e) => e.can().redo()) },
    ],
  ];

  /** Nur sichtbar, solange der Cursor in einer Tabelle steht */
  const tableTools: Tool[] = [
    { label: 'Zeile darunter einfügen', text: '+ Zeile', run: () => chain().addRowAfter().run() },
    { label: 'Spalte rechts einfügen', text: '+ Spalte', run: () => chain().addColumnAfter().run() },
    { label: 'Zeile löschen', text: '− Zeile', run: () => chain().deleteRow().run() },
    { label: 'Spalte löschen', text: '− Spalte', run: () => chain().deleteColumn().run() },
    { label: 'Tabelle löschen', text: '✕ Tabelle', run: () => chain().deleteTable().run() },
  ];
</script>

<div class="editor card" class:source>
  <div class="toolbar" role="toolbar" aria-label="Formatierung">
    {#each tools as toolGroup}
      <div class="group">
        {#each toolGroup as tool}
          <button
            type="button"
            class={tool.style}
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={tool.active ? tool.active() : undefined}
            disabled={source || !editor || (tool.enabled ? !tool.enabled() : false)}
            onclick={tool.run}>{tool.text}</button
          >
        {/each}
      </div>
    {/each}
    <span class="spacer"></span>
    <button type="button" class="mode" aria-pressed={source} onclick={toggleSource} title="Markdown-Quelltext bearbeiten">
      Markdown
    </button>
  </div>
  {#if !source && isActive('table')}
    <div class="toolbar table-tools" role="toolbar" aria-label="Tabelle">
      {#each tableTools as tool}
        <button type="button" title={tool.label} aria-label={tool.label} onclick={tool.run}>{tool.text}</button>
      {/each}
    </div>
  {/if}

  <div bind:this={element} class="surface" hidden={source}></div>
  {#if source}
    <textarea bind:value {maxlength} aria-label={`${label} (Markdown-Quelltext)`}></textarea>
  {/if}
</div>

<style>
  .editor { padding: 0; overflow: hidden; }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.75rem;
    align-items: center;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .group { display: flex; gap: 0.15rem; }
  .toolbar button { min-width: 2rem; padding: 0.15rem 0.45rem; font-size: 0.9rem; border-color: transparent; background: none; }
  .toolbar button:hover:not(:disabled) { border-color: var(--border); background: var(--surface); }
  .toolbar button[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .toolbar .mode { border-color: var(--border); }
  .table-tools { font-size: 0.85rem; }
  .surface :global(.ProseMirror) { min-height: 20rem; padding: 0.75rem 1rem; outline: none; }
  .surface :global(.ProseMirror p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: var(--muted);
    float: left;
    height: 0;
    pointer-events: none;
  }
  .surface :global(li > p), .surface :global(td > p), .surface :global(th > p) { margin: 0.15rem 0; }
  .surface :global(ul[data-type='taskList']) { list-style: none; padding-left: 0.25rem; }
  .surface :global(ul[data-type='taskList'] > li) { display: flex; gap: 0.5rem; align-items: baseline; }
  .surface :global(ul[data-type='taskList'] > li > label) { margin: 0; }
  .surface :global(ul[data-type='taskList'] > li > label > input) { width: auto; margin: 0; }
  .surface :global(ul[data-type='taskList'] > li > div) { flex: 1; }
  .surface :global(ul[data-type='taskList'] > li > div > p) { margin: 0.15rem 0; }
  .bold { font-weight: 700; }
  .italic { font-style: italic; font-family: serif; }
  .strike { text-decoration: line-through; }
  .surface :global(.selectedCell) { background: color-mix(in srgb, var(--accent) 15%, transparent); }
  .surface :global(.column-resize-handle) { display: none; }
  .surface :global(img.ProseMirror-selectednode) { outline: 2px solid var(--accent); }
  textarea { display: block; border: none; border-radius: 0; min-height: 20rem; padding: 0.75rem 1rem; }
</style>
