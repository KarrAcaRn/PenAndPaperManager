# Starter-Vorlage für eigene Themes

Diese Vorlage wird vom Server nicht geladen (der Ordnername beginnt mit `_`). Ein eigenes Theme daraus anlegen:

```sh
npm run theme:create -- <id> --name "Anzeigename"
```

Das kopiert den Ordner nach `data/themes/<id>/` (bzw. `THEMES_DIR`) und setzt ID, Namen und `$schema`. Von Hand
geht es auch: Ordner kopieren, umbenennen und in `theme.json` `id` (gleich dem Ordnernamen) und `name` ändern.

Ausführliche Anleitung mit allen Tokens: [`docs/themes.md`](../../docs/themes.md).

## Dateien

| Datei | Zweck |
| --- | --- |
| `theme.json` | Manifest: Name, Version, Token-Werte (Pflicht) |
| `theme.css` | Zusatz-CSS mit Beispielen (optional, Feld `css`) |
| `frame.svg` | Zierrahmen um Kopfleiste und Seitenleisten (Token `frame-image`) |
| `texture.svg` | dezente Kachel für den Seitenhintergrund (Token `bg-image`) |
| `preview.svg` | Vorschaubild für die Theme-Auswahl (Feld `preview`) |
| `README.md` | diese Erklärung; wird nicht ausgeliefert und darf gelöscht werden |

Nicht benötigte Dateien einfach löschen und die zugehörige Zeile aus `theme.json` entfernen (sonst meldet der
Validator „Datei fehlt“).

## `theme.json` Zeile für Zeile

JSON erlaubt keine Kommentare, deshalb stehen die Erklärungen hier.

```jsonc
{
  // Nur für Editoren: Autovervollständigung und Prüfung beim Tippen. Der Server ignoriert den Wert.
  "$schema": "../theme.schema.json",
  // Version des Manifest-Formats – immer 1.
  "manifestVersion": 1,
  // Kennung = Ordnername. Kleinbuchstaben, Ziffern, Bindestriche. Später nicht mehr ändern,
  // sonst verlieren Benutzer ihre Auswahl.
  "id": "mein-theme",
  // Anzeigename in den Einstellungen.
  "name": "Mein Theme",
  "author": "Dein Name",
  // Version deines Themes (MAJOR.MINOR.PATCH); bei jeder veröffentlichten Änderung erhöhen.
  "version": "1.0.0",
  "description": "…",
  // Lizenz von Theme, Grafiken und Schriften. Fremde Grafiken/Schriften mit Quelle nennen.
  "license": "CC0-1.0; Grafiken … selbst erstellt",
  // Bild im Theme-Ordner für die Theme-Auswahl (png, jpg, webp, gif, svg).
  "preview": "preview.svg",
  // Zusatz-CSS im Theme-Ordner – nur für das, was Tokens nicht können.
  "css": "theme.css",

  // Token-Werte für das helle Farbschema. Alles, was hier fehlt, kommt aus dem Standard-Theme.
  "tokens": {
    // Native Bedienelemente und SVG-Grafiken hell zeichnen.
    "color-scheme": "light",
    // Seitenhintergrund, Flächen (Karten, Felder, Knöpfe) und zurückgenommene Flächen (Hover, Code).
    "color-bg": "#eef2f0",
    "color-surface": "#ffffff",
    "color-surface-muted": "#e3eae7",
    // Rahmen- und Trennlinien.
    "color-border": "#b9c9c2",
    // Fließtext und Nebentext – Kontrast zu color-bg und color-surface mindestens 4,5:1.
    "color-text": "#1f2a27",
    "color-text-muted": "#4f605a",
    // Akzent (Hauptknöpfe, aktiver Reiter, gewählter Ordner) und Text darauf.
    // Links, Suchtreffer und Auswahl leiten sich im Standard-Theme davon ab.
    "color-accent": "#1d6b5a",
    "color-accent-text": "#ffffff",
    // Fehler und Löschen.
    "color-danger": "#b3261e",
    // Ecken von Karten, Knöpfen, Feldern.
    "border-radius": "6px",
    // Schatten von Karten und Kopfleiste; ohne Schatten "0 0 transparent" (nicht "none").
    "shadow-surface": "0 1px 3px rgba(0, 0, 0, 0.08)",
    // Zierrahmen: Grafik 72×72, zerschnitten bei 24 px, 24 px breit gezeichnet, Kanten gestreckt.
    "frame-image": "url('frame.svg')",
    "frame-slice": "24",
    "frame-width": "24px",
    "frame-repeat": "stretch",
    // Keine zusätzliche Kastenlinie unter dem Zierrahmen (die Grafik hat schon zwei Linien).
    "frame-line": "0 0 transparent",
    // Punkt-Textur auf dem Seitenhintergrund; "none" für keine.
    "bg-image": "url('texture.svg')",
    // Serifenschrift für Überschriften, Fließtext bleibt bei der Systemschrift.
    "font-heading": "Georgia, 'Times New Roman', serif"
  },

  // Abweichungen für das dunkle Farbschema. Alle Farben setzen, die sich ändern müssen –
  // was fehlt, gilt aus "tokens" (nicht aus dem dunklen Standard-Theme).
  "darkTokens": {
    // Native Bedienelemente und die SVGs (frame.svg, texture.svg) dunkel zeichnen.
    "color-scheme": "dark",
    "color-bg": "#141b19",
    "color-surface": "#1c2522",
    "color-surface-muted": "#24302c",
    "color-border": "#3a4d47",
    "color-text": "#e3ece8",
    "color-text-muted": "#a3b6af",
    // Auf dunklem Grund braucht der Akzent mehr Helligkeit; der Text darauf wird dunkel.
    "color-accent": "#5cc4a8",
    "color-accent-text": "#0e1513",
    "color-danger": "#ff8a80",
    "shadow-surface": "0 1px 3px rgba(0, 0, 0, 0.5)"
  }
}
```

## Prüfen

```sh
npm run theme:validate -- data/themes/<id>
```

Meldet Fehler (Theme wird nicht geladen) und Warnungen, z.B. zu geringen Kontrast. Die Vorlage selbst ist
fehlerfrei und erfüllt WCAG AA in hell und dunkel.
