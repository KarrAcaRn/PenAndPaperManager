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
`ADMIN_EMAILS` (kommagetrennte Logins, die den Admin-Bereich nutzen dürfen), dazu der Mailversand für die
Login-Codes: `MAIL_TRANSPORT` (`smtp` oder `log`), `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM` – Beispiel in `.env.example` (wird nicht automatisch geladen). Ohne SMTP-Konfiguration
schreibt der Server die Codes außerhalb von `NODE_ENV=production` nur ins Log; in Produktion schlägt der Versand
dann fehl (`MAIL_TRANSPORT=log` erzwingt das Log, z.B. für einen lokalen Testserver mit `NODE_ENV=production`).

Migrationen (`server/src/migrations/NNN_*.sql`) laufen beim Start automatisch; für den Login sind das
`003_session_token_hash.sql` (Sessions mit Token-Hash und Ablaufzeit – bestehende Logins werden dabei verworfen)
und `004_login_codes.sql` (Login-Codes).

## Login

Passwortlos per E-Mail-Code (`server/src/routes/login-codes.ts`, Seite `#/login`):

1. E-Mail eingeben → `POST /api/auth/request-code`. Der Server erzeugt einen 6-stelligen Code (10 Minuten gültig,
   gespeichert nur als scrypt-Hash) und verschickt ihn per `sendLoginCodeEmail` (`server/src/mail.ts`). Die Antwort
   ist für jede Adresse gleich (204), nur Rate-Limits (429) und Versandfehler (503) melden sich.
2. Code eingeben → `POST /api/auth/verify-code`. Richtig: Nutzer wird bei Bedarf angelegt, `createSession` setzt das
   Session-Cookie. Ein Code gilt einmal; nach 5 Fehlversuchen ist er verbrannt.
3. `GET /api/auth/me` liefert den Nutzer (ohne Login 401), `POST /api/auth/logout` beendet die Session.

Alle anderen `/api`-Routen verlangen eine Session (globaler Guard `requireAuthForApi` in `auth.ts`, dazu
`requireUser` in den Routen). Den früheren Test-Login `POST /api/auth/login` (nur E-Mail, ohne Code) gibt es
nicht mehr – damit konnte sich jeder als jede Adresse anmelden.

## Regeln

- Login per E-Mail-Code (siehe „Login“). Admins sind die Adressen aus `ADMIN_EMAILS`.
- Ein Login gilt höchstens 30 Tage (absolute Ablaufzeit, Benutzung verlängert nichts). Sessions liegen serverseitig
  in der Tabelle `sessions` (nur SHA-256-Hash des Tokens), Logout beendet nur die Session des aktuellen Geräts.
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
