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
npm run import-rulebook -- <PDF-Datei oder URL> "Titel"   # Regelwerk einspielen (siehe unten)
```

Umgebungsvariablen: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (`data/app.db`),
`ADMIN_EMAILS` (kommagetrennte Logins, die den Admin-Bereich nutzen dürfen),
`APP_SECRET_KEY` (32 Bytes Base64 zum Verschlüsseln gespeicherter Zugangsdaten; fehlt er, wird `data/secret.key`
angelegt – zusammen mit der Datenbank, aber getrennt von ihr sichern).

Google Drive als Soundboard-Speicher (optional; ohne diese drei Variablen bietet der Server Drive nicht an):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth-Client vom Typ „Webanwendung“ aus der Google Cloud Console) und
`GOOGLE_REDIRECT_URI` – exakt so in der Console eingetragen, z.B. lokal
`http://localhost:5173/api/storage/google-drive/oauth/callback` (Vite) bzw. `http://localhost:3000/…` (`npm start`),
in Produktion `https://<domain>/api/storage/google-drive/oauth/callback`. Optional `GOOGLE_APP_ORIGIN`, falls die
Seite unter einem anderen Origin läuft als die Redirect-URI. Einrichtung: `docs/soundboard-storage.md`.

## Regeln

- Login per E-Mail, in der Testphase ohne Passwort (`server/src/auth.ts`). Damit kann sich jeder als jede Adresse
  anmelden – auch als Admin aus `ADMIN_EMAILS`. Vor einem öffentlichen Betrieb muss eine echte Anmeldung her.
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
- Ordner bilden je Gruppe und Bereich einen Baum (Tabelle `folders`, Artikel hängen per `folder_id` daran); in der
  API werden sie als Pfad (z.B. `bar/foo`) angesprochen. Alle, die einen Bereich sehen, sehen alle Ordner darin –
  ein- und ausgeblendet werden nur Artikel über ihre Sichtbarkeit. Wird ein Artikel in einen noch nicht vorhandenen
  Ordner gespeichert, wird der Ordner angelegt. Umbenennen/Verschieben/Löschen (nur leer, auch ohne unsichtbare
  Artikel): Ersteller oder Spielleiter.

## Soundboard-Speicher

- Nutzer-Uploads speichert der Server nicht. Jeder Nutzer verknüpft in seinem Konto eigene externe Speicher
  (S3, Google Drive; mehrere möglich), Abspielen und Hochladen laufen per signierter URL direkt zwischen Browser
  und Anbieter. Verbindungen sieht und nutzt nur ihr Besitzer.
- Zugangsdaten liegen verschlüsselt in `user_storage_connections` und erscheinen in keiner API-Antwort.
- Architektur, API, Sicherheit (CORS) und Annahmen: `docs/soundboard-storage.md`.

## FATE-Bogen und Fertigkeiten

- Artikel in Charaktere und Notizen (z.B. NPCs) können optional einen FATE-Bogen haben (Layout nach
  `docs/charakterbogen-vorlage.html`, druckbar auf A4). Sichtbarkeit und Bearbeitungsrechte sind die des
  Artikels. Hinzugefügt, bearbeitet und entfernt wird der Bogen im
  Bearbeiten-Modus des Artikels (über dem Text, wie in der Ansicht) und erst mit „Speichern“ übernommen. In der
  Ansicht lässt sich nur der Zustand (Stress, Konsequenztexte) ändern; das wird sofort gespeichert, damit er im Spiel
  schnell angepasst werden kann. Im Bearbeiten-Modus ist der Zustand nur zu sehen.
- Bogen (`data`) und Zustand (`state`) werden getrennt gespeichert und tragen je eine eigene Version: Bearbeiten zwei
  Leute gleichzeitig dasselbe, bekommt der zweite einen Konflikt gemeldet, statt den ersten zu überschreiben. Wer im
  Spiel Stress ankreuzt, stört dagegen niemanden, der gerade den Bogen bearbeitet.
- Wie viele Stresskästchen je Leiste (körperlich/geistig) nutzbar sind, stellt man im Bearbeiten-Modus mit
  −/+ ein (1–6, Vorgabe 4); die übrigen sind ausgegraut.
- Konsequenzen: Vorgabe sind je eine leichte (2), mittlere (4) und schwere (6). Im Bearbeiten-Modus fügt +
  eine Zeile hinzu und − entfernt die letzte (höchstens 6); die Stufe jeder Zeile ist frei wählbar. Jede Zeile hat
  einen festen Schlüssel, an dem ihr Text im Zustand hängt. Ändert sich der Aufbau von Bogen oder Zustand, steht das
  in `character_sheets.format` und der Server wandelt ältere Formate beim Lesen um.
- Die Fertigkeiten auf dem Bogen legt der Spielleiter pro Gruppe fest (Bereich Spielleiter → Fertigkeiten).
  Umbenannte Fertigkeiten behalten ihre Werte, IDs gelöschter werden nie wiederverwendet.
- Ausgangspunkt sind Varianten (z.B. Fate Core, Turbo-Fate, Fate of Cthulhu), die beim ersten Start aus
  `server/src/presets/defaults.ts` eingespielt und danach im Admin-Bereich (`#/admin`) gepflegt werden.

## Regelwerk

- Reiter „Regelwerk“ in jeder Gruppe, für alle Mitglieder: links Inhaltsverzeichnis bzw. Volltextsuche, rechts das
  PDF im Viewer des Browsers (Klick auf einen Treffer springt zur Seite).
- Regelwerke gelten für alle Gruppen. Eingespielt werden sie auf dem Server per `npm run import-rulebook`; gleicher
  Titel ersetzt das vorhandene. Das PDF liegt unter `data/rulebooks/<id>.pdf`, der Text seitenweise in
  `rulebook_pages` mit FTS5-Index (`server/src/rulebooks.ts`).
- PDFs und ihr Text kommen nie ins Repository (Urheberrecht; `data/` ist ignoriert). Fate Kompakt darf laut
  Impressum für den privaten Gebrauch vervielfältigt werden.
- Suche: alle eingegebenen Wörter müssen auf der Seite vorkommen, jedes als Wortanfang („konseq“ findet
  „Konsequenzen“), Umlaute sind egal („uberwinden“). Seitenzahlen werden wie im Buch gedruckt angezeigt.
