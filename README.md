# Pen & Paper Manager

Webseite zur Unterstützung von Pen&Paper-Gruppen, speziell für das FATE-System.

- **Backend:** Node 24 + TypeScript, Fastify, SQLite (eingebautes `node:sqlite`)
- **Frontend:** Svelte 5 + Vite + TypeScript
- **shared/**: Typen und Pfad-Logik, die Server und Client gemeinsam nutzen

## Befehle

```sh
npm install
npm run dev     # Server auf :3000, Vite auf :5173 (dort öffnen)
npm test        # alle Tests: shared, Server (In-Memory-DB), Client (jsdom)
npm run coverage
npm run check   # Typprüfung Server + Client
npm run build && npm start   # Produktion: Server liefert das gebaute Frontend auf :3000
```

Umgebungsvariablen: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (`data/app.db`),
`ADMIN_EMAILS` (kommagetrennte Logins, die den Admin-Bereich nutzen dürfen).

## Regeln

- Login per E-Mail, in der Testphase ohne Passwort (`server/src/auth.ts`).
- Wer eine Gruppe anlegt, ist Spielleiter; Eingeladene sind Spieler. Es gibt immer mindestens einen Spielleiter.
- Bereiche: Charaktere, Notizen, Spielleiter. Der Bereich Spielleiter ist für Spieler unsichtbar.
- Neue Gruppen bekommen in Notizen und Spielleiter die Ordner „NPCs“, „Orte“ und „Sessions“
  (`DEFAULT_FOLDERS` in `shared`). Sie gehören dem Gründer, Spielleiter können sie umbenennen oder löschen.
- Artikel-Sichtbarkeit: Privat (nur Autor), Privat & Spielleiter, Öffentlich (`server/src/access.ts`).
- Bearbeiten: der Autor immer, Spielleiter alles, was sie sehen. Fremde Artikel kann man weder auf "Privat"
  stellen noch in einen Bereich schieben, den der Autor nicht sieht.
- Verliert ein Autor den Zugriff (aus der Gruppe entfernt, bzw. als Spielleiter degradiert für den Bereich
  Spielleiter), werden seine privaten Artikel dort zu "Privat & Spielleiter" – sonst könnte sie niemand mehr
  sehen oder löschen.
- Artikel liegen per `path` (z.B. `bar/foo`) in Ordnern. Leere Ordner stehen in der Tabelle `folders`;
  Ordner, die nur aus Artikelpfaden entstehen, sieht nur, wer darin einen Artikel sehen kann.

## FATE-Bogen und Fertigkeiten

- Artikel in Charaktere und Notizen (z.B. NPCs) können optional einen FATE-Bogen haben (Layout nach
  `docs/charakterbogen-vorlage.html`, druckbar auf A4). Sichtbarkeit und Bearbeitungsrechte sind die des
  Artikels; Änderungen werden automatisch gespeichert. Jeder Bogen trägt eine Version: Bearbeiten zwei
  Leute gleichzeitig, bekommt der zweite einen Konflikt gemeldet, statt den ersten zu überschreiben.
- Die Fertigkeiten auf dem Bogen legt der Spielleiter pro Gruppe fest (Bereich Spielleiter → Fertigkeiten).
  Umbenannte Fertigkeiten behalten ihre Werte, IDs gelöschter werden nie wiederverwendet.
- Ausgangspunkt sind Varianten (z.B. Fate Core, Turbo-Fate, Fate of Cthulhu), die beim ersten Start aus
  `server/src/presets/defaults.ts` eingespielt und danach im Admin-Bereich (`#/admin`) gepflegt werden.
