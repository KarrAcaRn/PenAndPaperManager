# Eigene Themes erstellen

Diese Anleitung richtet sich an Seitenbetreiber, die dem Pen & Paper Manager ein eigenes Aussehen geben wollen.
Ein Theme legt Farben, Rahmen, Schatten, Zierrahmen-Grafiken, Hintergründe und Schriften der ganzen Oberfläche
fest – ohne eine Zeile am Programmcode zu ändern und ohne den Server neu zu starten.

Inhalt:

1. [Schnellstart in 10 Minuten](#1-schnellstart-in-10-minuten)
2. [Wie ein Theme funktioniert](#2-wie-ein-theme-funktioniert)
3. [Ordnerstruktur](#3-ordnerstruktur)
4. [Das Manifest `theme.json`](#4-das-manifest-themejson)
5. [Token-Referenz](#5-token-referenz)
6. [Zusatz-CSS und Assets](#6-zusatz-css-und-assets)
7. [Installieren und bereitstellen](#7-installieren-und-bereitstellen)
8. [Default-Theme festlegen](#8-default-theme-festlegen)
9. [Prüfen mit `theme:validate`](#9-prüfen-mit-themevalidate)
10. [Versionierung und Kompatibilität](#10-versionierung-und-kompatibilität)
11. [Kontrast und Barrierefreiheit](#11-kontrast-und-barrierefreiheit)
12. [Beispiel: das Standard-Theme erklärt](#12-beispiel-das-standard-theme-erklärt)
13. [Fehlersuche](#13-fehlersuche)
14. [English summary](#14-english-summary)

---

## 1. Schnellstart in 10 Minuten

Voraussetzung: Der Pen & Paper Manager ist installiert (`npm ci --include=dev`) und läuft (`npm run dev` oder
`npm start`). Alle Befehle werden im Hauptordner des Projekts ausgeführt.

**Schritt 1 – Theme aus der Vorlage anlegen.** Die ID besteht aus Kleinbuchstaben, Ziffern und Bindestrichen:

```sh
npm run theme:create -- nachtwald --name "Nachtwald"
```

Das kopiert die Vorlage `themes/_template` nach `data/themes/nachtwald/` und trägt ID und Namen ein.

**Schritt 2 – Farben anpassen.** `data/themes/nachtwald/theme.json` in einem Editor öffnen. Wer VS Code nutzt,
bekommt dank der `$schema`-Zeile Autovervollständigung und eine Beschreibung zu jedem Token. Zum Beispiel:

```json
"author": "Beni",
"tokens": {
  "color-bg": "#f2efe8",
  "color-accent": "#5a3d8a",
  ...
}
```

Alles, was nicht im Manifest steht, übernimmt das Theme vom Standard-Theme. Man kann also mit drei, vier Farben
anfangen und nach und nach mehr festlegen.

**Schritt 3 – prüfen.**

```sh
npm run theme:validate -- data/themes/nachtwald
```

Der Validator meldet Fehler (das Theme würde nicht geladen) und Warnungen (z.B. zu wenig Kontrast) in Klartext.

**Schritt 4 – aktivieren.** Seite im Browser neu laden. Das Theme erscheint ohne Neustart in den Einstellungen
(Zahnrad rechts oben → Design) und kann dort gewählt werden. Zum schnellen Ausprobieren geht auch die
Browser-Konsole (F12):

```js
document.getElementById('theme-stylesheet').href = '/themes/nachtwald/theme.css';
```

Ab jetzt reicht nach jeder Änderung an den Theme-Dateien ein Neuladen der Seite.

---

## 2. Wie ein Theme funktioniert

- Die ganze Oberfläche bezieht Farben, Linien, Schatten, Rahmengrafiken und Schriften ausschließlich aus
  **Design-Tokens** – CSS Custom Properties wie `--color-accent`. Es gibt keine fest eingebauten Farben.
- Ein Theme ist ein Ordner mit einem **Manifest** (`theme.json`), das Werte für diese Tokens festlegt, und
  optional **Zusatz-CSS**, Grafiken und Schriften.
- Der Server erzeugt daraus pro Theme ein Stylesheet `/themes/<id>/theme.css`:

  ```css
  /* Theme nachtwald 1.0.0 – automatisch erzeugt */
  :root {
    --color-scheme: light;
    --color-bg: #eef2f0;
    …                                  /* alle Tokens, fehlende aus dem Basis-Theme */
  }

  @media (prefers-color-scheme: dark) {
    :root { --color-bg: #141b19; … }   /* darkTokens */
  }

  /* Zusatz-CSS des Themes */
  …                                    /* Inhalt der css-Datei */
  ```

- **Basis-Theme** ist `themes/default`. Es setzt jedes Token. Fehlende Tokens anderer Themes werden aus seinen
  hellen Werten ergänzt. Seine `darkTokens` werden *nicht* übernommen – sonst mischten sich fremde Farben in ein
  dunkles Theme.
- Die Oberfläche wechselt das Theme zur Laufzeit, indem sie das Stylesheet austauscht; das `<html>`-Element trägt
  dabei `data-theme="<id>"`.
- Der Server merkt Änderungen in den Theme-Ordnern selbst (Dateinamen, Größen, Änderungszeiten) und lädt dann
  neu. Ungültige Themes werden übersprungen und mit Begründung im Server-Log gemeldet; alle anderen bleiben nutzbar.

---

## 3. Ordnerstruktur

```
themes/                       mitgelieferte Themes (im Repository)
  theme.schema.json           JSON-Schema des Manifests
  default/                    Basis-Theme
    theme.json
    vine-frame.svg
  _template/                  Starter-Vorlage (wird vom Server nicht geladen)
    theme.json                Manifest mit Beispielwerten
    theme.css                 Zusatz-CSS mit kommentierten Beispielen
    frame.svg                 Zierrahmen (9-Slice)
    texture.svg               Hintergrundtextur
    preview.svg               Vorschaubild für die Theme-Auswahl
    README.md                 jede Zeile des Manifests erklärt
data/themes/                  eigene Themes des Seitenbetreibers (THEMES_DIR)
  nachtwald/
    theme.json                Pflicht
    theme.css                 optional, Name frei wählbar (Feld „css“)
    img/…, fonts/…            optional, Unterordner erlaubt
```

Regeln:

- **Ordnername = ID.** Der Ordner `nachtwald` muss im Manifest `"id": "nachtwald"` haben.
- Ordner, die mit `_` oder `.` beginnen, werden übersprungen (Vorlagen, `.git`).
- Eine ID darf nur einmal vorkommen. Eigene Themes können mitgelieferte nicht überschreiben – sie brauchen eine
  eigene ID.
- Ausgeliefert werden nur diese Dateitypen: `css, svg, png, jpg, jpeg, webp, gif, avif, woff, woff2, ttf, otf`.
  Die `theme.json` selbst und alle anderen Dateien (z.B. `README.md`) bleiben privat.

---

## 4. Das Manifest `theme.json`

Vollständiges Beispiel (die Vorlage):

```json
{
  "$schema": "../theme.schema.json",
  "manifestVersion": 1,
  "id": "mein-theme",
  "name": "Mein Theme",
  "author": "Dein Name",
  "version": "1.0.0",
  "description": "Starter-Vorlage: kühles Grün mit schlichtem Doppellinien-Rahmen …",
  "license": "CC0-1.0; Grafiken (frame.svg, texture.svg, preview.svg) selbst erstellt",
  "preview": "preview.svg",
  "css": "theme.css",
  "tokens": { "color-bg": "#eef2f0", "color-accent": "#1d6b5a", "…": "…" },
  "darkTokens": { "color-bg": "#141b19", "color-accent": "#5cc4a8", "…": "…" }
}
```

| Feld | Pflicht | Beschreibung |
| --- | --- | --- |
| `$schema` | nein | Pfad zu `themes/theme.schema.json`. Nur für Editoren (Autovervollständigung), der Server ignoriert den Wert. `theme:create` setzt ihn passend. |
| `manifestVersion` | ja | Version des Manifest-Formats, derzeit immer `1` (siehe [Versionierung](#10-versionierung-und-kompatibilität)). |
| `id` | ja | Eindeutige Kennung, gleich dem Ordnernamen. Kleinbuchstaben `a–z`, Ziffern, Bindestriche; höchstens 40 Zeichen; beginnt nicht mit Bindestrich. Wird in URLs und in den Benutzereinstellungen gespeichert – später nicht mehr ändern. |
| `name` | ja | Anzeigename in der Theme-Auswahl, höchstens 60 Zeichen. |
| `author` | ja | Autor bzw. Herausgeber, höchstens 100 Zeichen. |
| `version` | ja | Version des Themes im Format `MAJOR.MINOR.PATCH`, z.B. `1.2.0`. |
| `description` | nein | Kurze Beschreibung für die Theme-Auswahl, höchstens 500 Zeichen. |
| `license` | nein | Lizenz des Themes und seiner Grafiken/Schriften, höchstens 200 Zeichen. Bei fremden Grafiken oder Schriften hier Quelle und Lizenz nennen. |
| `preview` | nein | Vorschaubild im Theme-Ordner (`png, jpg, jpeg, webp, gif, svg`), z.B. `preview.png`. Empfohlen: 320×200 px oder gleiches Seitenverhältnis. |
| `css` | nein | Zusatz-CSS im Theme-Ordner (`.css`), wird nach den Tokens eingebunden. |
| `tokens` | ja | Werte für die Tokens (siehe [Token-Referenz](#5-token-referenz)). Darf leer sein (`{}`), dann sieht das Theme aus wie das Standard-Theme in hell. Unbekannte Token-Namen sind ein Fehler. |
| `darkTokens` | nein | Abweichende Werte für das dunkle Farbschema. Nur was sich unterscheidet; der Rest gilt aus `tokens`. |

Weitere Felder sind nicht erlaubt (Tippfehler fallen so sofort auf). JSON kennt keine Kommentare – Erklärungen
gehören in `description` oder eine eigene `README.md` im Theme-Ordner.

**Regeln für Token-Werte.** Jeder Wert ist ein einzeiliger CSS-Wert, genau so, wie er rechts vom Doppelpunkt in
einer CSS-Regel stünde:

- erlaubt: Farben (`#1d6b5a`, `rgb(29 107 90)`, `color-mix(…)`), Längen mit Einheit (`1px`, `0.5rem`), `calc(…)`,
  `var(--anderes-token)`, `url('datei.svg')`, Schriftlisten (`Georgia, 'Times New Roman', serif`);
- nicht erlaubt: `{ } < > \`, Kommentare `/* */`, Zeilenumbrüche, offene Klammern oder Anführungszeichen;
  `;` nur innerhalb von Anführungszeichen oder `url(…)`;
- Längen brauchen eine Einheit (`0px`, nicht `0`), sonst greift `calc(…)` nicht;
- `shadow-surface` und `frame-line` dürfen nicht `none` sein – für „kein Schatten“ `0 0 transparent` schreiben;
- relative `url(…)` beziehen sich auf den Theme-Ordner, die Datei muss existieren. Externe Adressen
  (`https://…`) und `data:`-URLs sind erlaubt, werden aber nicht geprüft.

---

## 5. Token-Referenz

Jedes Token steht im CSS als `--<name>` zur Verfügung, z.B. `var(--color-accent)`. Tokens dürfen andere Tokens
verwenden: `"color-link": "var(--color-accent)"`. Die Spalte „Standard“ zeigt den Wert des Basis-Themes (hell),
der gilt, wenn ein Theme das Token nicht setzt.

Die Liste ist im Code in `THEME_TOKENS` (`shared/src/theme.ts`) definiert; ein Test stellt sicher, dass diese
Tabelle vollständig ist.

### Farben

| Token | Wirkt auf | Standard | Beispiel |
| --- | --- | --- | --- |
| `color-scheme` | Farbschema der nativen Bedienelemente (Scrollleisten, Auswahllisten, Datumsfelder) und von SVG-Grafiken mit `prefers-color-scheme`. Werte: `normal`, `light`, `dark`, `light dark`. | `normal` | `light`, in `darkTokens` `dark` |
| `color-bg` | Seitenhintergrund hinter allem | `#f6f1e7` | `#eef2f0` |
| `color-surface` | Flächen: Karten, Kopfleiste, Eingabefelder, Knöpfe, aufklappende Menüs | `#fffdf8` | `#ffffff` |
| `color-surface-muted` | zurückgenommene Flächen: Hover im Ordnerbaum, Codeblöcke, Werkzeugleiste des Editors | `var(--color-bg)` | `#e3eae7` |
| `color-border` | Rahmen- und Trennlinien von Karten, Feldern, Knöpfen, Listen, Tabellen | `#ddd3c0` | `#b9c9c2` |
| `color-text` | Fließtext, Beschriftungen, Text in Knöpfen und Feldern | `#2b2620` | `#1f2a27` |
| `color-text-muted` | Nebentext: Hinweise, Zitate, Abzeichen, Seitenzahlen | `#7a6f60` | `#4f605a` |
| `color-link` | Links und Link-Knöpfe („Abbrechen“, „Bearbeiten“) | `var(--color-accent)` | `#0b5f8a` |
| `color-accent` | Akzent: Hauptknöpfe („Speichern“), aktiver Reiter, gewählter Ordner, Rahmen beim Überfahren von Knöpfen, Spielleiter-Abzeichen | `#8a3b12` | `#1d6b5a` |
| `color-accent-text` | Text und Symbole auf Akzentflächen (Hauptknöpfe, aktiver Reiter) | `#fff` | `#ffffff` |
| `color-accent-hover` | halbtransparente Überlagerung für Symbolknöpfe auf Akzentflächen (Stift/Plus am gewählten Ordner) | `rgba(255, 255, 255, 0.2)` | `rgba(0, 0, 0, 0.15)` |
| `color-danger` | Fehlermeldungen, Löschen-Knöpfe, Abzeichen „privat“ | `#a3261f` | `#b3261e` |
| `color-highlight` | Hervorhebung von Suchtreffern in den Regelwerken | `color-mix(in srgb, var(--color-accent) 25%, transparent)` | `#fff3a0` |
| `color-selection` | Auswahl im Editor (markierte Tabellenzellen) | `color-mix(in srgb, var(--color-accent) 15%, transparent)` | `rgba(29, 107, 90, 0.15)` |

### Rahmen

| Token | Wirkt auf | Standard | Beispiel |
| --- | --- | --- | --- |
| `border-width` | Breite normaler Rahmen: Karten, Knöpfe, Felder, Trennlinien in Listen und Tabellen | `1px` | `2px` |
| `border-style` | Linienart normaler Rahmen | `solid` | `dashed` |
| `border-width-strong` | betonte Linien: Zitatbalken, Markierung im Inhaltsverzeichnis der Regelwerke | `3px` | `4px` |
| `outline-width` | Fokus- und Ablage-Markierungen (Drag & Drop im Ordnerbaum, ausgewähltes Bild im Editor) | `2px` | `3px` |
| `border-radius` | Ecken von Karten, Knöpfen, Feldern, Menüs, Codeblöcken | `8px` | `0px` (eckig) |
| `border-radius-small` | kleine Ecken (Suchtreffer) | `2px` | `0px` |
| `radius-pill` | Ecken der Abzeichen (Sichtbarkeit eines Artikels, Rolle in der Gruppe) | `999px` | `4px` |

### Schatten

| Token | Wirkt auf | Standard | Beispiel |
| --- | --- | --- | --- |
| `shadow-surface` | Schatten von Karten und Kopfleiste (auch gerahmt). Kein `none` – ohne Schatten `0 0 transparent`. | `0 0 transparent` | `0 2px 6px rgba(0, 0, 0, 0.12)` |
| `shadow-popup` | Schatten aufklappender Menüs (Plus-Menü im Ordnerbaum) | `0 4px 14px rgba(0, 0, 0, 0.18)` | `0 8px 24px rgba(0, 0, 0, 0.3)` |

### Zierrahmen

Zierrahmen umgeben die Kopfleiste einer Gruppe und die Seitenleisten (Ordnerbaum, Inhaltsverzeichnis der
Regelwerke) – das sind die Elemente mit der Klasse `.frame`. Sie werden per
[`border-image`](https://developer.mozilla.org/de/docs/Web/CSS/border-image) als 9-Slice gezeichnet: Die Grafik
wird in ein 3×3-Raster zerschnitten, die Ecken bleiben unverändert, die Kanten werden gestreckt oder wiederholt,
die Mitte entfällt.

| Token | Wirkt auf | Standard | Beispiel |
| --- | --- | --- | --- |
| `frame-image` | die Rahmengrafik; `none` für keinen Zierrahmen | `url('vine-frame.svg')` | `url('frame.svg')`, `none` |
| `frame-slice` | wo die Grafik zerschnitten wird (`border-image-slice`, Zahl = Pixel der Grafik) | `32` | `24` |
| `frame-width` | wie breit der Rahmen gezeichnet wird; `0px` ohne Grafik | `33px` | `24px` |
| `frame-outset` | wie weit der Rahmen über den Kasten hinausragt | `calc(var(--frame-width) / 2)` | `0px` |
| `frame-repeat` | wie die Kanten gefüllt werden: `stretch`, `repeat`, `round`, `space` | `round` | `stretch` |
| `frame-line` | Kastenlinie gerahmter Kästen als `box-shadow`. Kein `none` – ohne Linie `0 0 transparent`. | `inset 0 0 0 var(--border-width) var(--color-border)` | `0 0 transparent` |
| `frame-padding` | Innenabstand gerahmter Kästen, damit Text nicht unter der Grafik liegt | `calc(var(--frame-width) / 2 + 0.4rem)` | `1rem` |

Ohne Zierrahmen: `"frame-image": "none"`, `"frame-width": "0px"`, `"frame-outset": "0px"`, `"frame-padding": "1rem"`;
die Kastenlinie (`frame-line`) bleibt dann als normaler Rahmen sichtbar.

### Hintergründe

| Token | Wirkt auf | Standard | Beispiel |
| --- | --- | --- | --- |
| `bg-image` | Hintergrundbild oder Textur der Seite (liegt über `color-bg`, wird gekachelt); `none` für keines | `none` | `url('texture.svg')`, `linear-gradient(#fff, #eee)` |
| `surface-image` | Hintergrundbild/Textur von Karten und Kopfleiste (über `color-surface`); `none` für keines | `none` | `url('img/pergament.webp')` |

### Schriften

| Token | Wirkt auf | Standard | Beispiel |
| --- | --- | --- | --- |
| `font-body` | Fließtext und alle Bedienelemente | `system-ui, sans-serif` | `'Source Sans 3', sans-serif` |
| `font-heading` | Überschriften `h1`–`h3` | `var(--font-body)` | `Georgia, 'Times New Roman', serif` |
| `font-mono` | Markdown-Quelltext im Editor | `ui-monospace, monospace` | `'JetBrains Mono', monospace` |

Eigene Schriftdateien: siehe [Zusatz-CSS und Assets](#6-zusatz-css-und-assets).

### Charakterbogen

Der FATE-Charakterbogen ist einem gedruckten Bogen nachempfunden und wird auch so gedruckt. Seine Linienstärken
und Maße sind deshalb fest; Farben und Schriften kommen aus diesen Tokens.

| Token | Wirkt auf | Standard | Beispiel |
| --- | --- | --- | --- |
| `sheet-paper` | Papierfarbe des Bogens, auch Druckhintergrund | `#fff` | `#fbf6e9` |
| `sheet-ink` | Schrift- und Linienfarbe des Bogens | `#1a1a1a` | `#2b2620` |
| `sheet-line` | Schreiblinien | `#9a9a9a` | `#b3a58c` |
| `sheet-faded` | deaktivierte Stresskästchen | `#c9c9c9` | `#d9cfbd` |
| `sheet-focus` | Hintergrund des gerade bearbeiteten Feldes | `#eef3fa` | `#f3ead6` |
| `sheet-accent` | Balken, Kästchen und Trennlinie | `#4a72a8` | `#7a2e12` |
| `sheet-on-accent` | Text auf den Balken | `#fff` | `#fff` |
| `sheet-logo` | Hintergrund des Logos oben rechts (Schrift in `sheet-paper`) | `#111` | `#3b2a1a` |
| `sheet-shadow` | Schatten des Bogens auf der Seite | `0 4px 24px rgba(0, 0, 0, 0.45)` | `0 0 transparent` |
| `sheet-font` | Schrift des Bogens | `'Roboto Condensed', 'Arial Narrow', Arial, sans-serif` | `'Alegreya Sans', sans-serif` |
| `sheet-font-heading` | Überschriften und Werte des Bogens | `Oswald, 'Arial Narrow', Arial, sans-serif` | `'Cinzel', serif` |

Tipp: Der Bogen wird meist ausgedruckt. Helles Papier und dunkle Tinte lassen ihn auch auf dem Drucker lesbar.

---

## 6. Zusatz-CSS und Assets

Die meisten Themes kommen mit Tokens aus. Für alles andere (Schriftdateien, Verläufe, Abstände, Effekte) gibt es
das Zusatz-CSS: eine `.css`-Datei im Theme-Ordner, im Manifest unter `"css"` eingetragen. Der Server hängt sie an
die Tokens an.

```css
/* data/themes/nachtwald/theme.css */

/* eigene Schrift: Datei liegt in data/themes/nachtwald/fonts/ */
@font-face {
  font-family: 'Nachtwald Serif';
  src: url('fonts/nachtwald-serif.woff2') format('woff2');
  font-display: swap;
}

/* Überschriften in der Akzentfarbe */
:root h1,
:root h2 {
  color: var(--color-accent);
}
```

Und im Manifest: `"font-heading": "'Nachtwald Serif', Georgia, serif"`.

Regeln:

- **Selektoren mit `:root` beginnen.** Das Grund-CSS der Seite wird nach dem Theme geladen und gewinnt sonst bei
  gleicher Spezifität. `:root h1` ist stärker als `h1`. Das Zusatz-CSS ist nur geladen, solange das Theme aktiv
  ist, es kann also nicht in andere Themes hineinwirken.
- **Nur stabile Klassen ansprechen.** Verlässlich sind Elemente und die allgemeinen Klassen aus `client/src/app.css`:
  `main`, `h1`–`h3`, `a`, `button`, `button.primary`, `.button`, `button.danger`, `button.link`, `input`, `select`,
  `textarea`, `label`, `.card`, `.frame`, `.badge`, `.badge.private`, `.badge.gm`, `.muted`, `.error`, `ul.list`,
  `.markdown` (gerenderte Artikel). Klassen mit Anhängsel `svelte-…` ändern sich bei jedem Build – nicht verwenden.
- **Farben über Tokens.** Im Zusatz-CSS `var(--color-accent)` statt `#1d6b5a` schreiben, dann stimmt auch das
  dunkle Farbschema.
- **Dunkle Varianten über `darkTokens`**, nicht über `@media (prefers-color-scheme: dark)` im Zusatz-CSS:
  `darkTokens` sind die eine Stelle, an der das Theme das dunkle Farbschema beschreibt – so bleibt es auch dann
  stimmig, wenn die App das Farbschema anders als über die Systemeinstellung bestimmt.
- **Bewegung zurückhaltend** und nur innerhalb von `@media (prefers-reduced-motion: no-preference) { … }`.
- **Dateien relativ einbinden** (`url('img/holz.webp')`). Sie müssen im Theme-Ordner liegen und einen erlaubten
  Typ haben – der Validator prüft jede `url(…)`, auch in Kommentaren. Externe Schriften (z.B. Google Fonts per
  `@import url('https://…')`) funktionieren, laden aber Daten von fremden Servern; lieber die Schriftdatei
  mitliefern.

**Grafiken.** SVG ist ideal: klein, scharf in jeder Größe und kann mit `@media (prefers-color-scheme: dark)` im
SVG selbst die Farben wechseln (siehe `themes/_template/frame.svg`). Die Grafik folgt dabei dem Token
`color-scheme`, deshalb in `darkTokens` `"color-scheme": "dark"` setzen. Rastergrafiken als `webp` oder `png`,
Texturen möglichst klein und nahtlos kachelbar.

**Eine Rahmengrafik bauen** (für `frame-image`): Bild mit drei gleich breiten Bändern je Richtung, z.B. 72×72 px
bei `frame-slice` 24. Die vier 24×24-Ecken bleiben, wie sie sind; die Kantenstücke dazwischen werden gestreckt
(`frame-repeat: stretch`) oder gekachelt (`round`/`repeat`) – dort also nur Muster, die das vertragen (gerade
Linien bzw. nahtlose Kacheln). `frame-width` ist die gezeichnete Breite; gleich `frame-slice` in px bedeutet 1:1.

---

## 7. Installieren und bereitstellen

**Ablageort.** Eigene Themes gehören in den Theme-Ordner des Seitenbetreibers:

- Vorgabe: `data/themes/` – neben der Datenbank, also `themes/` im Ordner von `DB_PATH`.
- Anderer Ort: Umgebungsvariable `THEMES_DIR` setzen, z.B. `THEMES_DIR=/srv/pnp/themes npm start`.

`data/` ist nicht im Git-Repository; eigene Themes überstehen damit jedes Update des Programms. Sicherungen von
`data/` enthalten sie automatisch.

**Installieren** heißt: Theme-Ordner dorthin kopieren. Ein Neustart ist nicht nötig, der Server erkennt neue,
geänderte und gelöschte Themes beim nächsten Seitenaufruf. Beispiele:

```sh
# fertiges Theme aus einem ZIP
unzip nachtwald.zip -d data/themes/        # ergibt data/themes/nachtwald/theme.json

# Theme aus einem Git-Repository
git clone https://example.org/nachtwald.git data/themes/nachtwald

# auf einen Server kopieren
scp -r nachtwald/ server:/srv/pnp/data/themes/
```

Danach prüfen: `npm run theme:validate` (ohne Pfad prüft es alle Themes) und einen Blick ins Server-Log werfen.
Ein abgelehntes Theme steht dort als `Theme in … abgelehnt: <Gründe>`.

**Weitergeben.** Ein Theme ist nur sein Ordner. Zum Teilen den Ordner zippen oder als Git-Repository
veröffentlichen; `README.md` und Lizenzangaben gehören dazu, `theme.json` muss im obersten Ordner liegen.

**Deinstallieren.** Ordner löschen (oder mit `_` vorne umbenennen, um ihn nur abzuschalten). Benutzer, die das
Theme gewählt hatten, bekommen automatisch das Default-Theme.

**Mitliefern** (für Entwickler des Projekts): Themes in `themes/` im Repository sind für alle Installationen
verfügbar. Sie unterliegen denselben Regeln; Grafiken müssen frei lizenziert oder selbst erstellt sein.

---

## 8. Default-Theme festlegen

Das Default-Theme sehen alle, die nichts anderes gewählt haben – Gäste, neue Benutzer und Benutzer, deren
gewähltes Theme gelöscht wurde.

- Ohne Einstellung ist es das Basis-Theme `default`.
- Der Seitenbetreiber legt es mit der Umgebungsvariable `DEFAULT_THEME` fest, z.B.
  `DEFAULT_THEME=nachtwald npm start`. Gibt es das Theme nicht (mehr), gilt wieder `default`.

> Hinweis: `DEFAULT_THEME` kommt zusammen mit der Theme-Auswahl in den Benutzereinstellungen. Solange sie fehlt,
> ist immer `default` das Default-Theme.

Das Basis-Theme `default` selbst bleibt unabhängig davon die Quelle für fehlende Tokens; es sollte nicht verändert
werden – ein eigenes Theme ist der bessere Weg.

---

## 9. Prüfen mit `theme:validate`

```sh
npm run theme:validate                               # alle Themes in themes/ und THEMES_DIR
npm run theme:validate -- data/themes/nachtwald      # ein Theme (Ordner oder theme.json)
npm run theme:validate -- data/themes/a data/themes/b
```

Der Validator prüft genau wie der Server – was er als gültig meldet, lädt auch der Server – und ergänzt Hinweise:

- **Fehler** (✘): Das Theme wird nicht geladen. Beispiele:
  - `Pflichtfeld „author“ fehlt.`
  - `Unbekanntes Token „farbe“ in „tokens“.` – Tippfehler im Token-Namen
  - `„tokens.color-bg“ ist ungültig – erlaubt ist ein einzeiliger CSS-Wert ohne …` – z.B. ein `;` am Ende
  - `Die ID „nachtwald2“ muss dem Ordnernamen „nachtwald“ entsprechen.`
  - `tokens.frame-image: Datei „rahmen.svg“ fehlt im Theme-Ordner …`
  - `tokens.shadow-surface: „none“ ist hier nicht erlaubt, stattdessen „0 0 transparent“.`
  - `theme.json ist kein gültiges JSON: … (line 3 column 5)` – meist ein fehlendes Komma oder eine Klammer
- **Warnungen**: Das Theme funktioniert, sollte aber verbessert werden – vor allem zu geringer Kontrast (siehe
  nächster Abschnitt) oder ein Ordner, den der Server überspringt.
- **Hinweise**: z.B. wie viele Tokens vom Basis-Theme kommen oder welche Farbpaare sich nicht automatisch prüfen
  lassen.

Exit-Code: `0` alles gültig (Warnungen erlaubt), `1` mindestens ein Theme fehlerhaft, `2` falscher Aufruf. Damit
lässt sich der Validator auch in einer CI-Pipeline verwenden.

`theme:create` meldet Fehler ebenso verständlich, z.B. eine ungültige ID mit Vorschlag
(`Äther Grün` → `aether-gruen`) oder eine ID, die schon vergeben ist. Optionen: `--name "Anzeigename"`,
`--dir <Zielordner>` (Vorgabe `THEMES_DIR` bzw. `data/themes`).

---

## 10. Versionierung und Kompatibilität

Es gibt zwei Versionsnummern:

**`version` – die Version deines Themes** (`MAJOR.MINOR.PATCH`). Empfehlung:

- PATCH (`1.0.1`): Korrekturen, z.B. eine Farbe mit besserem Kontrast;
- MINOR (`1.1.0`): Ergänzungen, z.B. neue `darkTokens` oder ein Vorschaubild;
- MAJOR (`2.0.0`): deutlich anderes Aussehen.

Die Version steht im erzeugten Stylesheet und in der API (`GET /api/themes`). Die ID bleibt über alle Versionen
gleich, sonst verlieren Benutzer ihre Auswahl.

**`manifestVersion` – die Version des Manifest-Formats**, derzeit `1`. Sie wird nur bei inkompatiblen Änderungen
des Formats erhöht (z.B. wenn Tokens umbenannt oder entfernt werden). Dann wird die Änderung in dieser Anleitung
beschrieben; ein Manifest mit falscher `manifestVersion` wird abgelehnt.

Was bei Updates des Pen & Paper Managers passiert:

- **Neue Tokens** (z.B. für ein neues Bedienelement) sind kompatibel: Dein Theme setzt sie nicht und bekommt den
  Wert des Basis-Themes. Prüfe nach Updates einmal das Aussehen und ergänze die neuen Tokens bei Bedarf –
  `npm run theme:validate` zeigt, wie viele Tokens vom Basis-Theme kommen.
- **Umgekehrt** ist ein Theme, das neue Tokens benutzt, auf einer älteren Version des Programms ungültig
  („Unbekanntes Token“). Wer Themes weitergibt, nennt deshalb in der `README.md` die Programmversion, für die es
  gebaut wurde.
- **Zusatz-CSS** ist weniger stabil als Tokens: Klassen können sich ändern. Je mehr über Tokens läuft, desto
  sicherer übersteht ein Theme Updates.

---

## 11. Kontrast und Barrierefreiheit

Ein Theme muss für alle lesbar bleiben – auch auf schwachen Bildschirmen, bei Sonnenlicht, mit Sehschwäche.

**Kontrast nach WCAG AA:**

- Text mindestens **4,5:1** gegen seinen Hintergrund (große Überschriften ab 24 px: 3:1);
- Bedienelemente und wichtige Grafiken (Rahmen von Eingabefeldern, Fokus-Markierung) mindestens **3:1**.

`theme:validate` prüft diese Paare automatisch, hell und – falls vorhanden – dunkel:

| Vordergrund | Hintergrund | wo |
| --- | --- | --- |
| `color-text` | `color-bg`, `color-surface`, `color-surface-muted` | Fließtext |
| `color-text-muted` | `color-bg`, `color-surface` | Nebentext, Abzeichen |
| `color-link` | `color-bg`, `color-surface` | Links |
| `color-accent` | `color-surface` | Akzent-Abzeichen, gewählter Ordner |
| `color-accent-text` | `color-accent` | Hauptknöpfe, aktiver Reiter |
| `color-danger` | `color-surface` | Fehlermeldungen, Löschen |
| `sheet-ink` | `sheet-paper` | Charakterbogen |
| `sheet-on-accent` | `sheet-accent` | Balken des Bogens |
| `sheet-paper` | `sheet-logo` | Logo des Bogens |

Werte mit `color-mix(…)`, Transparenz oder Bildern kann er nicht berechnen; er nennt sie als Hinweis. Die prüfst
du im Browser, z.B. mit den Entwicklerwerkzeugen (Element untersuchen → Farbwähler zeigt das Kontrastverhältnis)
oder einem Kontrastrechner wie <https://webaim.org/resources/contrastchecker/>.

**Weitere Empfehlungen:**

- **Texturen und Hintergrundbilder** dezent halten. Text liegt direkt darauf; unruhige Bilder senken den
  wirksamen Kontrast stärker, als die Rechnung zeigt.
- **Nicht nur über Farbe unterscheiden.** Fehler, „privat“-Abzeichen und Akzent sollten sich auch für Menschen
  mit Rot-Grün-Schwäche unterscheiden – über Helligkeit, nicht nur über den Farbton.
- **Fokus sichtbar lassen.** Nicht `outline: none` im Zusatz-CSS; `outline-width` nicht unter `2px`.
- **Dunkles Farbschema mitdenken.** Ohne `darkTokens` sieht das Theme bei dunklem Systemschema genauso aus wie
  hell – das ist erlaubt, aber dann bewusst. Wer `darkTokens` setzt, setzt alle Farben, die sich ändern müssen:
  eine helle Akzentfarbe aus `tokens` auf dunklem Hintergrund aus `darkTokens` ergibt sonst schlechten Kontrast
  (der Validator meldet das).
- **Schriftgrößen** werden nicht über Tokens festgelegt; Zierschriften nur für Überschriften verwenden und eine gut
  lesbare Fließtextschrift wählen. Immer Ersatzschriften angeben (`'Meine Schrift', Georgia, serif`).
- **Bewegung** (Übergänge, Animationen) nur in `@media (prefers-reduced-motion: no-preference)`.
- **Druck:** Der Charakterbogen wird gedruckt – dunkles Papier kostet Tinte und wird grau.
- **Probe:** Alle Hauptansichten ansehen – Gruppenübersicht, Ordnerbaum mit gewähltem Ordner, Artikel mit
  Tabelle und Zitat, Editor, Regelwerk mit Suchtreffern, Charakterbogen, Fehlermeldung (z.B. Login mit falschem
  Code) – jeweils hell und dunkel.

---

## 12. Beispiel: das Standard-Theme erklärt

`themes/default/theme.json` ist das Basis-Theme und zeigt die meisten Möglichkeiten. Die wichtigsten Stellen:

```json
"color-bg": "#f6f1e7",
"color-surface": "#fffdf8",
"color-surface-muted": "var(--color-bg)",
```

Warme Papiertöne: Die Seite ist etwas dunkler als die Karten, so heben sich Karten ohne Schatten ab
(`"shadow-surface": "0 0 transparent"`). Zurückgenommene Flächen verwenden einfach die Seitenfarbe – ein Token
darf auf ein anderes verweisen.

```json
"color-link": "var(--color-accent)",
"color-highlight": "color-mix(in srgb, var(--color-accent) 25%, transparent)",
"color-selection": "color-mix(in srgb, var(--color-accent) 15%, transparent)",
```

Links, Suchtreffer und Auswahl leiten sich vom Akzent ab. Ändert ein Theme nur `color-accent`, ziehen diese drei
automatisch mit – auch in `darkTokens`, wo nur `color-accent` neu gesetzt wird.

```json
"frame-image": "url('vine-frame.svg')",
"frame-slice": "32",
"frame-width": "33px",
"frame-outset": "calc(var(--frame-width) / 2)",
"frame-repeat": "round",
"frame-line": "inset 0 0 0 var(--border-width) var(--color-border)",
"frame-padding": "calc(var(--frame-width) / 2 + 0.4rem)",
```

Der Zweigrahmen: `vine-frame.svg` ist 128×128 px, zerschnitten bei 32 px. Die Ecken sind 32×32, die Kanten
werden mit `round` gekachelt – deshalb beginnt und endet der Zweig in jeder Kachel waagerecht an derselben Stelle,
damit die Kacheln nahtlos anschließen. `frame-outset` lässt den Rahmen zur Hälfte nach außen ragen,
`frame-padding` hält den Text von der inneren Hälfte fern, und `frame-line` zeichnet zusätzlich die normale
Kastenlinie, auf der der Zweig „liegt“.

```json
"darkTokens": {
  "color-bg": "#1d1a17",
  "color-surface": "#27231f",
  "color-accent": "#e08a4f",
  "color-accent-text": "#1d1a17",
  …
}
```

Im dunklen Schema werden nur die Farben getauscht. Der Akzent wird heller (auf dunklem Grund braucht er mehr
Helligkeit für denselben Kontrast), und deshalb wird der Text auf Akzentflächen dunkel. Die Zweig-Grafik wechselt
ihre Farben selbst per `@media (prefers-color-scheme: dark)` im SVG.

Ein eigenes Theme im Stil „Fantasy“ würde hier ansetzen: Pergament-Textur über `surface-image`, eine
Ornament-Grafik in `frame-image`, Gold als `color-accent` (Kontrast prüfen – Gold auf Pergament ist meist zu
hell, dunkles Altgold oder Braun funktionieren) und eine Serifenschrift in `font-heading`. Die Vorlage
`themes/_template` zeigt dasselbe Prinzip mit Doppellinien-Rahmen, Punkt-Textur und Serifen-Überschriften.

---

## 13. Fehlersuche

| Problem | Ursache und Lösung |
| --- | --- |
| Theme erscheint nicht in der Auswahl | `npm run theme:validate` ausführen und Server-Log lesen. Häufig: Ordner liegt nicht in `THEMES_DIR`, Ordnername ≠ `id`, Ordner beginnt mit `_`, `theme.json` liegt eine Ebene zu tief (nach dem Entpacken). |
| Änderung wirkt nicht | Seite neu laden (Strg+F5). Wurde wirklich die Datei im aktiven Ordner geändert? `GET /themes/<id>/theme.css` im Browser öffnen und den erzeugten Inhalt prüfen. |
| Ein Token wirkt nicht | Tippfehler im Wert (z.B. Länge ohne Einheit), oder `var(--…)` verweist auf ein unbekanntes Token. In den Entwicklerwerkzeugen am `<html>`-Element die Custom Properties ansehen. |
| Zusatz-CSS wirkt nicht | Selektor mit `:root` beginnen (siehe Abschnitt 6); keine `svelte-…`-Klassen verwenden. |
| Rahmengrafik verzerrt oder mit Lücken | `frame-slice` passt nicht zur Grafik, oder die Kanten vertragen `frame-repeat` nicht (mit `stretch` probieren). |
| Grafik fehlt | Pfad relativ zum Theme-Ordner? Erlaubter Dateityp? Groß-/Kleinschreibung beachten (Linux-Server). |
| Im dunklen Modus unlesbar | `darkTokens` vollständig setzen (alle Farben, die sich ändern), `color-scheme` auf `dark`; `theme:validate` meldet die Kontraste. |

---

## 14. English summary

A theme is a folder with a `theme.json` manifest (schema: `themes/theme.schema.json`) plus optional extra CSS,
images and fonts. Built-in themes live in `themes/`; operators drop their own into `THEMES_DIR` (default
`data/themes`), no restart required. The folder name must equal the manifest `id`; folders starting with `_` or
`.` are ignored.

Required manifest fields: `manifestVersion` (1), `id`, `name`, `author`, `version` (x.y.z), `tokens`. Optional:
`description`, `license`, `preview` (image), `css` (extra stylesheet), `darkTokens` (overrides for the dark colour
scheme). Every design token (section 5 lists all of them) becomes a CSS custom property `--<name>`; tokens a theme
does not set fall back to the base theme `default` (light values only).

Quick start: `npm run theme:create -- my-theme`, edit `data/themes/my-theme/theme.json`,
`npm run theme:validate -- data/themes/my-theme` (reports schema errors, missing files and WCAG AA contrast
problems; exit code 1 on errors), reload the page and pick the theme in the settings. Extra CSS selectors should
start with `:root` and only target the generic classes from `client/src/app.css`. Keep text contrast at 4.5:1 or
better.
