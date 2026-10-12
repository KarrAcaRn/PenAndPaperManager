<script lang="ts" module>
  /** all: alles bearbeitbar (Bearbeiten-Modus); condition: nur Zustand (Stress, Konsequenzen); none: nur lesen */
  export type SheetEditable = 'all' | 'condition' | 'none';
</script>

<script lang="ts">
  import {
    ASPECT_LABELS,
    CONSEQUENCES,
    MAX_SHEET_LINE_LENGTH,
    MAX_SKILL_VALUE,
    MAX_STUNTS_LENGTH,
    MIN_SKILL_VALUE,
    STRESS_LABELS,
    type AspectKey,
    type SheetData,
    type Skill,
    type StressKey,
  } from '@pnp/shared';

  // Layout nach docs/charakterbogen-vorlage.html (A4, druckbar). Die Fertigkeiten kommen aus der Gruppe.
  let {
    data = $bindable(),
    skills,
    editable = 'none',
    onchange = () => {},
  }: { data: SheetData; skills: Skill[]; editable?: SheetEditable; onchange?: () => void } = $props();

  const readonly = $derived(editable !== 'all');
  const conditionReadonly = $derived(editable === 'none');

  /** Frei nutzbare Kästchen; die übrigen sind wie auf dem Papierbogen ausgegraut (durch Fertigkeiten freigeschaltet) */
  const BASE_STRESS_BOXES = 4;
  /** Höhe, die der Fertigkeiten-Block auf der A4-Seite hat */
  const SKILLS_HEIGHT_MM = 150;
  const MM_PER_PT = 0.3528;

  // Viele Fertigkeiten (Fate Core: 18) müssen weiter auf eine Seite passen: zweispaltig und kleiner.
  const columns = $derived(skills.length > 9 ? 2 : 1);
  const rowHeight = $derived(SKILLS_HEIGHT_MM / Math.max(1, Math.ceil(skills.length / columns)));
  const skillSize = $derived(Math.min(columns === 1 ? 18 : 12, Math.max(7, (rowHeight * 0.5) / MM_PER_PT)));

  const aspectKeys = Object.keys(ASPECT_LABELS) as AspectKey[];
  const stressKeys = Object.keys(STRESS_LABELS) as StressKey[];

  function setSkill(id: number, raw: string) {
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) delete data.skills[id];
    else data.skills[id] = Math.min(MAX_SKILL_VALUE, Math.max(MIN_SKILL_VALUE, value));
  }

  /** Aspektfelder wachsen mit dem Inhalt; der Stunts-Bereich darunter gibt den Platz her. */
  function grow(node: HTMLTextAreaElement) {
    const fit = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    fit();
    node.addEventListener('input', fit);
    return { destroy: () => node.removeEventListener('input', fit) };
  }
</script>

<div class="scroll">
  <!-- Alle Felder (auch Kästchen und Fertigkeiten) melden Änderungen über das hochlaufende input-Ereignis -->
  <div class="page" oninput={onchange}>
    <header class="head">
      <label class="field"><span class="label">Name</span><span class="rule"><input class="f" bind:value={data.name} {readonly} maxlength={MAX_SHEET_LINE_LENGTH} /></span></label>
      <label class="field"><span class="label">Alter</span><span class="rule"><input class="f" bind:value={data.age} {readonly} maxlength="4" /></span></label>
      <label class="field"><span class="label">Pronomen</span><span class="rule"><input class="f" bind:value={data.pronouns} {readonly} maxlength={MAX_SHEET_LINE_LENGTH} /></span></label>
      <div class="logo"><span class="swash"></span>FATE</div>
    </header>

    <div class="body">
      <section class="col left">
        <div class="top">
          <div class="banner left"><h2>Aspekte</h2></div>
          <div class="aspects">
            {#each aspectKeys as key}
              <label class="aspect">
                <span class="label">{ASPECT_LABELS[key]}</span>
                <textarea class="f" rows="2" bind:value={data.aspects[key]} {readonly} maxlength={MAX_SHEET_LINE_LENGTH} use:grow></textarea>
              </label>
            {/each}
          </div>
        </div>

        <div class="bottom">
          <div class="banner left"><h2>Stunts</h2></div>
          <p class="hint">
            Die ersten drei Stunts sind gratis. Du kannst weitere Stunts für den Preis von je einem Punkt Erholungsrate dazukaufen,
            solange die Erholungsrate nicht unter eins fällt.
          </p>
          <div class="stunts-area">
            <textarea class="f" aria-label="Stunts" bind:value={data.stunts} {readonly} maxlength={MAX_STUNTS_LENGTH}></textarea>
          </div>

          <div class="refresh">
            <div class="bar">
              <h2>Erholungsrate</h2>
              <small>Zu Anfang drei Punkte.</small>
            </div>
            <div class="circle"><input class="f" aria-label="Erholungsrate" bind:value={data.refresh} {readonly} maxlength="2" /></div>
          </div>
        </div>
      </section>

      <section class="col right">
        <div class="top">
          <div class="banner right"><h2>Zustand</h2></div>

          <p class="sub">Stress</p>
          {#each stressKeys as track}
            <div class="track">
              <span class="name">{STRESS_LABELS[track]}</span>
              <div class="boxes">
                {#each data.stress[track] as _, index}
                  <label class:off={index >= BASE_STRESS_BOXES}>
                    <input
                      type="checkbox"
                      bind:checked={data.stress[track][index]}
                      disabled={conditionReadonly}
                      aria-label="{STRESS_LABELS[track]}er Stress {index + 1}"
                    />
                    <span>1</span>
                  </label>
                {/each}
              </div>
            </div>
          {/each}

          <p class="sub consequences-title">Konsequenzen</p>
          <div class="consequences">
            {#each CONSEQUENCES as cons}
              <label class="cons" class:off={cons.optional}>
                <span class="tag">{cons.value}</span>
                <span class="rule">
                  <span class="label">{cons.label}</span>
                  <input class="f" bind:value={data.consequences[cons.key]} readonly={conditionReadonly} maxlength={MAX_SHEET_LINE_LENGTH} />
                </span>
              </label>
            {/each}
          </div>
        </div>

        <div class="bottom">
          <div class="banner right"><h2>Fertigkeiten</h2></div>
          <p class="hint">
            Verteile zweimal eine Gute (+3), dreimal eine Ordentliche (+2) und zweimal eine Durchschnittliche (+1). Der Rest ist Mäßig (+0).
          </p>

          {#if skills.length === 0}
            <p class="hint">Der Spielleiter hat für diese Gruppe noch keine Fertigkeiten festgelegt.</p>
          {/if}
          <div class="skills" class:dense={columns === 2} style:--skill-size="{skillSize}pt" style:--skill-columns={columns}>
            {#each skills as skill (skill.id)}
              <label class="skill">
                <span class="plus">+</span>
                <span class="slot">
                  <input
                    class="f"
                    inputmode="numeric"
                    maxlength="2"
                    value={data.skills[skill.id] ?? ''}
                    {readonly}
                    oninput={(e) => setSkill(skill.id, e.currentTarget.value)}
                  />
                </span>
                <span class="n">{skill.name}</span>
              </label>
            {/each}
          </div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .scroll { overflow-x: auto; }

  .page {
    --accent: #4a72a8;
    /* Zeilenhöhe der Aspektfelder und daraus abgeleitete Höhe des oberen Blocks:
       Balken (10,5) + 5 Aspekte à (Label 4,5 + 2 Zeilen à 5,2 + 1) + 3 Abstand */
    --aspect-line: 5.2mm;
    --top-h: 94.3mm;
    --ink: #1a1a1a;
    --line: #9a9a9a;
    --faded: #c9c9c9;
    --focus: #eef3fa;

    box-sizing: border-box;
    position: relative;
    width: 210mm;
    height: 297mm;
    margin: 0 auto 1rem;
    padding: 10mm 9mm 8mm;
    background: #fff;
    color: var(--ink);
    font-family: 'Roboto Condensed', 'Arial Narrow', Arial, sans-serif;
    line-height: normal;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .page :global(*) { box-sizing: border-box; }
  .page label { display: flex; font-weight: inherit; margin: 0; }

  /* ---------- Eingabefelder ---------- */
  .f {
    font: inherit;
    color: inherit;
    width: 100%;
    border: 0;
    border-radius: 0;
    padding: 0;
    margin: 0;
    background: transparent;
    outline: none;
    resize: none;
    min-height: 0;
  }
  .f:focus { background: var(--focus); }
  .f:read-only:focus { background: transparent; }
  /* Schreibgeschützte Felder bleiben per Tastatur erreichbar - der Fokus muss sichtbar sein */
  .f:read-only:focus-visible { outline: 1px dashed var(--line); outline-offset: 1px; }

  /* ---------- Kopfzeile ---------- */
  .head { display: grid; grid-template-columns: 1fr 30mm 44mm auto; align-items: flex-end; gap: 6mm; margin-bottom: 2mm; }
  .field { align-items: flex-end; gap: 3mm; }
  .field > .label { font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; padding-bottom: 0.6mm; }
  .field > .rule { flex: 1; border-bottom: 1px solid var(--line); height: 7mm; display: flex; align-items: flex-end; }
  .field .rule .f { font-size: 12pt; padding-bottom: 0.8mm; }
  .logo {
    display: inline-flex;
    align-items: center;
    background: #111;
    color: #fff;
    padding: 1.2mm 3.2mm 1.2mm 2.4mm;
    border-radius: 1.2mm;
    font-family: Oswald, 'Arial Narrow', Arial, sans-serif;
    font-weight: 700;
    font-size: 17pt;
    letter-spacing: 0.02em;
    line-height: 1;
    transform: skewX(-4deg);
  }
  .logo .swash { display: inline-block; width: 4mm; height: 4mm; margin-right: 0.8mm; background: #fff; clip-path: polygon(0 55%, 100% 0, 78% 52%, 100% 100%, 20% 68%); }

  /* ---------- Spaltenraster ---------- */
  .body { flex: 1; display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
  .col { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .col.left { padding-right: 6mm; border-right: 1.6pt solid var(--accent); }
  .col.right { padding-left: 6mm; }

  /* Im Ausgangszustand sind beide oberen Blöcke gleich hoch, damit die zweiten Balken (Stunts / Fertigkeiten)
     auf einer Linie liegen. Wachsen die Aspektfelder, wird nur der Stunts-Bereich kleiner. */
  .col > .top { flex: none; }
  .col.left > .top { min-height: var(--top-h); }
  .col.right > .top { height: var(--top-h); }
  .col > .bottom { flex: 1; display: flex; flex-direction: column; min-height: 0; }

  /* ---------- Überschriftenbalken ---------- */
  .banner { background: var(--accent); height: 8.5mm; flex: none; display: flex; align-items: center; margin-bottom: 2mm; }
  .banner h2, .refresh .bar h2 {
    margin: 0;
    font-family: Oswald, 'Arial Narrow', Arial, sans-serif;
    font-weight: 700;
    font-size: 19pt;
    line-height: 1;
    letter-spacing: 0.04em;
    color: #fff;
    text-transform: uppercase;
    transform: skewX(-6deg);
  }
  .banner.left { justify-content: flex-start; margin-left: -9mm; padding-left: 9mm; padding-right: 4mm; }
  .banner.right { justify-content: flex-end; margin-right: -9mm; padding-right: 9mm; padding-left: 4mm; }
  .hint { font-size: 6.6pt; line-height: 1.28; font-style: italic; flex: none; margin: 0 0 2.5mm; }

  /* ---------- Aspekte ---------- */
  .aspects { margin-bottom: 3mm; }
  .aspect { position: relative; padding: 4.5mm 0 1mm; border-bottom: 1px solid var(--line); }
  .aspect > .label { position: absolute; left: 0; top: 1mm; font-size: 7pt; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; }
  .aspect .f { font-size: 11pt; line-height: var(--aspect-line); min-height: calc(2 * var(--aspect-line)); overflow: hidden; display: block; }

  /* ---------- Zustand ---------- */
  .sub { text-align: center; font-size: 8pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 1mm; }
  .consequences-title { margin-top: 2.5mm; }
  .track { display: flex; align-items: center; gap: 2mm; margin-bottom: 1.6mm; }
  .track .name { flex: 1; text-align: right; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .boxes { display: flex; }
  .boxes input { position: absolute; opacity: 0; pointer-events: none; width: auto; }
  .boxes label { display: block; margin-left: -1pt; }
  .boxes label > span { width: 6.2mm; height: 6.2mm; border: 1pt solid var(--ink); display: flex; align-items: center; justify-content: center; font-size: 9pt; font-weight: 700; cursor: pointer; }
  .boxes label > span:hover { background: var(--focus); }
  .boxes input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 1px; }
  .boxes input:disabled + span { cursor: default; }
  .boxes input:disabled + span:hover { background: transparent; }
  .boxes input:checked + span, .boxes input:checked:disabled + span:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
  .boxes label.off > span { border-color: var(--faded); color: transparent; }
  .boxes label.off input:checked + span { border-color: var(--accent); color: #fff; }

  .consequences { margin-top: 3.5mm; }
  .cons { align-items: center; gap: 2.5mm; margin-bottom: 3.2mm !important; }
  .cons .tag { width: 9mm; height: 6.4mm; flex: none; border: 1pt solid var(--ink); clip-path: polygon(0 0, 100% 0, 100% 62%, 76% 100%, 0 100%); display: flex; align-items: center; padding-left: 1mm; font-size: 11pt; font-weight: 700; }
  .cons .rule { flex: 1; border-bottom: 1px solid var(--line); height: 6.4mm; position: relative; display: flex; align-items: flex-end; }
  .cons .rule > .label { position: absolute; left: 0; top: 0; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; pointer-events: none; }
  .cons .rule .f { font-size: 10.5pt; padding: 0 0 0.4mm 17mm; }
  .cons.off .tag { border-color: var(--faded); color: var(--faded); }
  .cons.off .rule { border-bottom-color: var(--faded); }
  .cons.off .rule > .label { color: var(--faded); }

  /* ---------- Stunts ---------- */
  .stunts-area { flex: 1; min-height: 0; display: flex; }
  .stunts-area .f { height: 100%; font-size: 10.5pt; line-height: 1.5; font-family: inherit; }

  /* ---------- Erholungsrate ---------- */
  .refresh { position: relative; margin: 4mm -9mm 0 -9mm; padding-left: 9mm; height: 10mm; flex: none; }
  .refresh .bar { position: absolute; inset: 0; background: var(--accent); display: flex; flex-direction: column; align-items: flex-end; justify-content: center; padding-right: 3mm; }
  .refresh .bar h2 { font-size: 18pt; line-height: 0.95; letter-spacing: 0.03em; }
  .refresh .bar small { font-size: 6.4pt; font-style: italic; color: #fff; margin-top: 0.4mm; }
  .refresh .circle { position: absolute; left: 13mm; bottom: 0.5mm; width: 21mm; height: 21mm; border: 1.4pt solid var(--accent); border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
  .refresh .circle .f { font-family: Oswald, 'Arial Narrow', Arial, sans-serif; font-size: 20pt; text-align: center; border-radius: 50%; height: 12mm; }

  /* ---------- Fertigkeiten ---------- */
  .skills {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--skill-columns), minmax(0, 1fr));
    grid-auto-flow: row;
    align-content: start;
    gap: calc(var(--skill-size) * 0.55) 3mm;
  }
  .skill { align-items: baseline; gap: 1.5mm; min-width: 0; }
  .skill .plus { font-size: var(--skill-size); line-height: 1; }
  .skill .slot { width: 17mm; flex: none; border-bottom: 1.2px solid var(--ink); }
  .skills.dense .slot { width: 9mm; }
  .skill .slot .f { font-family: Oswald, 'Arial Narrow', Arial, sans-serif; font-size: calc(var(--skill-size) * 0.95); text-align: center; padding-bottom: 0.3mm; }
  .skill .n { font-family: Oswald, 'Arial Narrow', Arial, sans-serif; font-weight: 400; font-size: var(--skill-size); line-height: 1.05; overflow-wrap: anywhere; }

  @media print {
    .scroll { overflow: visible; }
    .page { margin: 0; box-shadow: none; }
    .f:focus { background: transparent; }
    .boxes label > span:hover { background: transparent; }
    @page { size: A4 portrait; margin: 0; }
  }
</style>
