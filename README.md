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
npm run theme:create -- <id>         # eigenes Theme aus der Vorlage anlegen (siehe docs/themes.md)
npm run theme:validate -- [<Ordner>] # Themes prüfen (Schema, Dateien, Kontrast)
```

Umgebungsvariablen: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (`data/app.db`),
`ADMIN_EMAILS` (kommagetrennte Logins, die den Admin-Bereich nutzen dürfen),
`SOUNDS_DIR` und `SOUNDS_BASE_URL` (Standard-Sounds, siehe unten),
`APP_SECRET_KEY` (32 Bytes Base64 zum Verschlüsseln gespeicherter Zugangsdaten; fehlt er, wird `data/secret.key`
angelegt – zusammen mit der Datenbank, aber getrennt von ihr sichern),
`S3_ALLOW_PRIVATE_ENDPOINTS=1` (S3-Endpoints im lokalen Netz und per http erlauben, z.B. eigenes MinIO; sonst gesperrt),
`THEMES_DIR` (eigene Themes, Vorgabe `themes/` neben der Datenbank, also `data/themes`),
`DEFAULT_THEME` (Theme-ID für alle ohne eigene Wahl, Vorgabe `default`), dazu der Mailversand für die
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
   Session-Cookie. Ein Code gilt einmal; nach 5 Fehlversuchen ist er verbrannt. Pro Adresse sind höchstens 10 Fehlversuche
   in 24 Stunden möglich (über alle Codes), danach ist der Login für diese Adresse bis zum Ablauf gesperrt.
3. `GET /api/auth/me` liefert den Nutzer (ohne Login 401), `POST /api/auth/logout` beendet die Session.

Alle anderen `/api`-Routen verlangen eine Session (globaler Guard `requireAuthForApi` in `auth.ts`, dazu
`requireUser` in den Routen); ausgenommen sind nur `GET /api/themes` und `GET /api/themes/:id` (auch die
Anmeldeseite ist gestaltet). Den früheren Test-Login `POST /api/auth/login` (nur E-Mail, ohne Code) gibt es
nicht mehr – damit konnte sich jeder als jede Adresse anmelden.

Google Drive als Soundboard-Speicher (optional; ohne diese drei Variablen bietet der Server Drive nicht an):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth-Client vom Typ „Webanwendung“ aus der Google Cloud Console) und
`GOOGLE_REDIRECT_URI` – exakt so in der Console eingetragen, z.B. lokal
`http://localhost:5173/api/storage/google-drive/oauth/callback` (Vite) bzw. `http://localhost:3000/…` (`npm start`),
in Produktion `https://<domain>/api/storage/google-drive/oauth/callback`. Optional `GOOGLE_APP_ORIGIN`, falls die
Seite unter einem anderen Origin läuft als die Redirect-URI. Einrichtung: `docs/soundboard-storage.md`.

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
- Besitzer (Autor) wechseln: wer den Artikel bearbeiten darf (Autor oder Spielleiter), kann ihn im Bearbeiten-Modus
  einem anderen Mitglied geben – z.B. legt der Spielleiter einen Charakter an und gibt ihn dem Spieler. Der neue
  Besitzer muss den Bereich sehen können. Danach gelten die Rechte des neuen Besitzers; wer abgibt, sieht bzw.
  bearbeitet ihn womöglich nicht mehr. Das gilt auch, wenn ein Spielleiter einem Spieler den Artikel wegnimmt
  oder weitergibt (bewusst erlaubt; der neue Besitzer darf ihn dann auch auf „Privat“ stellen). Das Formular
  sagt jeweils vorher, wer danach was nicht mehr sieht bzw. bearbeiten kann. „Zuletzt geändert“ bleibt dabei.
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
- Oberfläche: Bereich „Speicher“ auf der Einstellungsseite `#/settings` – Verbindungen ansehen, testen, entfernen und
  neue anlegen (S3 per Formular mit Verbindungstest vor dem Speichern, Google Drive per „Mit Google verbinden“ und
  anschließender Ordnerauswahl). Zugangsdaten erscheinen nach dem Speichern nur noch maskiert.

## Soundboard-Seite

- `#/sounds` (Link im Benutzermenü und auf der Login-Seite), `client/src/routes/Soundboard.svelte`. Ohne Login
  gibt es nur die Standard-Sounds (`GET /api/sounds/builtin` steht deshalb in `PUBLIC_API_PATHS`), mit Login
  zusätzlich je verbundenem Speicher einen Abschnitt.
- Suche über Titel, Kategorie/Ordner und Schlagwörter (alle Wörter müssen passen; wer sucht, sucht über alle
  Kategorien, Bereich „Suche“), Filter nach Quelle (Standard / Speicher) und Kategorie-Leiste mit ‹ ›. Kategorien
  sind die des Manifests und die Unterordner im eigenen Speicher (S3; Google Drive nur der verbundene Ordner).
  Klick auf eine Kachel spielt ab bzw. stoppt.
- Zwei Kanäle wie im Referenz-Soundboard (`lib/soundPlayer.svelte.ts`): **Hintergrundmusik** – immer nur ein Titel,
  ein neuer ersetzt den laufenden (harter Wechsel), auf Wunsch in Schleife; **Effekte** – beliebig viele
  gleichzeitig, auch über der Musik. Regler für Gesamt-, Musik- und Effektlautstärke, „Musik stoppen“, „Effekte
  stoppen“, „Alle stoppen“ und eine Anzeige des laufenden Musiktitels. Umschalter „Alle / Hintergrundmusik /
  Effekte“ filtern die Kacheln. Je Kachel zusätzlich eigene Lautstärke und Endlosschleife
  (`lib/soundSettings.svelte.ts`, `pnp.soundboard.sounds`); ein Sound klingt mit Gesamt × Kanal × eigener
  Lautstärke und läuft in Schleife, wenn seine eigene Schleife an ist oder – bei Musik – „Musik wiederholen“.
- Typ je Sound (`sfx` | `music`): Vorgabe aus dem Manifest (`type`), eigene Dateien sind zunächst Effekte. Jede
  Kachel hat eine Typ-Auswahl (ein laufender Sound stoppt beim Umstellen), beim Upload wählt man den Typ für die
  neuen Dateien. Der Browser merkt sich Lautstärken und Schleife (`localStorage` `pnp.soundboard`; ältere
  Einstellungen: `volume` gilt als Gesamtlautstärke, der frühere Schalter „Mehrere Sounds gleichzeitig“ entfällt)
  sowie die vom Nutzer geänderten Typen (`pnp.soundboard.types`, nur Abweichungen von der Vorgabe, Schlüssel =
  Kachel-`key`).
- Tastatur wie im Referenz-Soundboard (`lib/soundHotkeys.ts`): die sichtbaren Kacheln bekommen der Reihe nach
  `0–9`, `a–z`, `A–Z`; Pfeil links/rechts wechselt die Kategorie, hoch/runter die Musik-Lautstärke, Alt springt in
  die Suche. Beim Tippen in Feldern und bei offenem Dialog ist das aus. Vergleich mit der Referenz:
  `docs/soundboard-feature-gap.md`.
- Nutzer-Dateien holen ihre Playback-URL erst beim Abspielen, behalten sie bis 30 s vor Ablauf und holen bei einem
  Ladefehler einmal eine neue (`createPlaybackUrlCache` in `lib/soundboard.ts`).
- Upload per Dateiauswahl oder Drag-and-drop in den gewählten Ziel-Speicher: Upload-URL vom Server holen, dann
  per XHR mit Fortschritt direkt zum Anbieter (`lib/upload.ts`); nur mp3/wav/ogg/m4a bis 50 MB, danach wird die
  Liste neu geladen. Abgelaufener Upload-Link → einmal neuer Link; CORS-Sperre bzw. Verbindungsabbruch werden
  erklärt.
- Eigene Dateien lassen sich nach Bestätigung löschen, Standard-Sounds nicht. Ohne verbundenen Speicher gibt es
  statt des Uploads einen Hinweis mit Link zu den Kontoeinstellungen (`#/settings`).

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

## Benutzereinstellungen

- Jeder Login hat eigene Einstellungen, gruppenübergreifend. Gespeichert als JSON-Objekt in `user_settings` (eine
  Zeile je Benutzer, wird beim ersten Speichern angelegt); fehlt sie oder ein Feld, gelten die Vorgaben.
- Felder, Vorgaben, JSON-Schema und Prüfung stehen in `shared/src/settings.ts` (`USER_SETTINGS`). Neue Einstellung:
  dort eintragen – Validierung und Vorgaben ziehen mit, keine Migration nötig. Gespeicherte Werte, die nicht (mehr)
  erlaubt sind, werden beim Lesen durch die Vorgabe ersetzt.
- Derzeit:
  - `colorScheme` – `"system"` (Vorgabe, folgt dem Browser), `"light"`, `"dark"`. Bis Migration
    `007_settings_color_scheme.sql` hieß dieses Feld `theme`.
  - `theme` – ID des gewählten Themes oder `null` (Vorgabe der Seite, siehe `DEFAULT_THEME`).
- API (nur eingeloggt, sonst 401; immer nur die eigenen Einstellungen, eine Benutzer-ID gibt es in der Route nicht):
  - `GET /api/me/settings` → `200 { "colorScheme": "system", "theme": null }` – alle Einstellungen, mit Vorgaben
    aufgefüllt. Ein gespeichertes Theme, das es nicht mehr gibt, kommt als `null`; gespeichert bleibt es (legt der
    Seitenbetreiber es zurück, greift es wieder).
  - `PATCH /api/me/settings` mit z.B. `{ "theme": "wald" }` → `200` mit allen Einstellungen nach dem Speichern.
    Nur die gesendeten Felder ändern sich; unbekannte Felder werden ignoriert, ungültige Werte geben
    `400 { "error": "Ungültige Eingabe: …" }`, ein unbekanntes Theme `400 { "error": "Das Theme „…“ gibt es nicht." }`.
- Oberfläche: Seite `#/settings` (Zahnrad rechts oben). Abschnitt „Design“ zeigt alle Themes (`GET /api/themes`) als
  Radiogruppe mit Name, Autor, Beschreibung und Vorschau (Vorschaubild aus dem Manifest, sonst eine Mini-Seite aus
  den Farb-Tokens, bei dunkler Variante zweimal). Auswahl (auch per Pfeiltasten) wirkt sofort als Vorschau,
  „Speichern“ übernimmt sie, „Verwerfen“ oder Verlassen der Seite ohne Speichern nimmt die Vorschau zurück.
  Neue einfache Felder bekommen in `client/src/routes/Settings.svelte` einen Eintrag in `sections`.
- Anwenden (`client/src/lib/userSettings.svelte.ts`): Farbschema als `data-color-scheme` an `<html>` (ohne Attribut
  entscheidet `prefers-color-scheme`), Theme per `applyTheme`. Fehlt das gewählte Theme oder lädt es nicht, gilt
  das Vorgabe-Theme der Seite, danach `default` – ohne Fehlermeldung.
- Ohne Aufblitzen: Farbschema und ausdrücklich gewähltes Theme liegen in `localStorage` (`pnp-color-scheme`,
  `pnp-theme-id`; ohne eigene Wahl kein Eintrag). `client/index.html` lädt das Basis-Theme immer per `<link>` und
  schreibt per Inline-Skript vor dem ersten Zeichnen den Link des gemerkten Themes bzw. ohne Wahl
  `/themes/site-default.css` (Weiterleitung auf das aktuelle Vorgabe-Theme der Seite). Beide blockieren das Rendern
  wie normale Links. Fehlt das gemerkte Theme inzwischen, entfernt sich der Link, das Basis-Theme bleibt, bis die
  App die Vorgabe anwendet. Grenze: Hat man Theme oder Farbschema auf einem anderen Gerät geändert, zeigt dieses
  Gerät beim nächsten Aufruf kurz noch seinen gemerkten Stand, bis `/api/me/settings` geantwortet hat.
- Gäste (ohne Login): Auf der Anmeldeseite wählt eine Auswahlliste „Design“ das Theme, gespeichert nur im Browser
  (`pnp-guest-theme`). Beim Logout (bzw. ohne gültige Session) gilt wieder diese Gast-Wahl bzw. die Vorgabe.

## Themes

Anleitung für eigene Themes (Manifest, alle Tokens, Zusatz-CSS, Bereitstellen, Kontrast): **`docs/themes.md`**.
Starter-Vorlage: `themes/_template`.

- Farben, Rahmen, Schatten, Zierrahmen-Grafiken und Schriften der ganzen Oberfläche kommen aus Design-Tokens
  (CSS Custom Properties). Liste und Bedeutung aller Tokens: `THEME_TOKENS` in `shared/src/theme.ts`.
- Ein Theme ist ein Ordner mit `theme.json` (Schema: `themes/theme.schema.json`, erzeugt per
  `npm run theme:schema -w server`) und optional Zusatz-CSS, Grafiken und Schriften. Die ID im Manifest muss dem
  Ordnernamen entsprechen; Ordner, die mit `_` oder `.` beginnen, werden übersprungen (Vorlagen).
- Mitgelieferte Themes liegen in `themes/`, eigene legt der Seitenbetreiber in `THEMES_DIR` (`data/themes`) ab –
  ohne Codeänderung und ohne Neustart. Ungültige Manifeste werden mit Begründung im Server-Log abgelehnt, doppelte
  IDs ebenso.
- Mitgeliefert: `default`, `fantasy` (Pergament, Holzrahmen mit Gold, Zierschrift), `clean` (minimalistisch, hell)
  und `scifi` (dunkel, Neon, abgeschrägte Ecken). Sie nutzen nur Tokens und Zusatz-CSS und dienen als Beispiele
  für eigene Themes; Grafiken sind selbst erstellt, Schriften stehen unter der SIL Open Font License
  (`fonts/OFL-*.txt`). `fantasy`, `clean` und `scifi` haben ein festes Farbschema (kein `darkTokens`), die
  Einstellung Hell/Dunkel wirkt bei ihnen nicht.
- Basis-Theme ist `default` (das bisherige Aussehen, hell/dunkel). Es setzt jedes Token; fehlende Tokens anderer
  Themes werden daraus ergänzt. `darkTokens` (Abweichungen bei dunklem Farbschema) werden nicht ergänzt, sonst
  mischten sich fremde Farben ein.
- Vorgabe-Theme für alle ohne eigene Wahl: `DEFAULT_THEME` (Theme-ID); fehlt es, gilt `default` (Warnung im Log
  beim Start). `GET /api/themes` liefert `{ themes, defaultTheme }`, bei jedem Aufruf neu bestimmt;
  `GET /themes/site-default.css` leitet (302, `no-cache`) auf dessen Stylesheet weiter.
- Der Server erzeugt je Theme `/themes/<id>/theme.css` (Tokens auf `:root`, danach `darkTokens` – bei dunklem
  System-Farbschema, außer `data-color-scheme="light"`, und immer bei `data-color-scheme="dark"` –, danach das
  Zusatz-CSS) und liefert Theme-Dateien unter `/themes/<id>/…` aus (nur Grafiken, Schriften, CSS).
  Relative `url(…)` in Token-Werten werden dabei absolut gemacht. API: `GET /api/themes`, `GET /api/themes/:id`.
- Im Client (`client/src/lib/theme.ts`): `listThemes()`, `themeCatalog()`, `getTheme(id)`, `applyTheme(id)` – tauscht
  das Stylesheet zur Laufzeit und setzt `data-theme` am `<html>`-Element.

## Soundboard: Standard-Sounds

Der Betreiber stellt eine kleine, kuratierte Bibliothek bereit, die alle nutzen können (auch ohne Login). Eigene
Sounds der Nutzer liegen dagegen in deren externem Storage; der Server speichert keine Nutzer-Uploads. In die
Standardbibliothek lädt die Web-App nichts hoch – sie wird nur auf dem Server gepflegt.

- Ordner: `server/sounds/default/` (anderer Ort per `SOUNDS_DIR`). Darin die Audio-Dateien (`.mp3`, `.wav`, `.ogg`,
  `.m4a`, gern in Unterordnern wie `musik/` und `effekte/`) und das Manifest `sounds.json`.
- Manifest – je Sound ein Eintrag, Pfad relativ zum Ordner:

  ```json
  {
    "version": 1,
    "sounds": [
      { "id": "glocke", "title": "Glocke", "category": "Effekte", "file": "effekte/glocke.wav", "type": "sfx",
        "durationSec": 2, "tags": ["Signal"], "license": "CC0 1.0, Quelle: …" }
    ]
  }
  ```

  Pflicht sind `id` (eindeutig, nur `a–z`, `0–9`, `-`, `_`; nach dem Veröffentlichen nicht mehr ändern, Nutzer
  können sich darauf beziehen), `title`, `category` (z.B. „Musik“, „Effekte“) und `file` (ohne `; ? : @ & = + $ , #`
  im Namen). Optional: `type` (`sfx` = Effekt, `music` = Hintergrundmusik; ohne Angabe `sfx` – im Soundboard
  kann jeder Nutzer das für sich umstellen), `durationSec` (Sekunden), `tags` (höchstens 10) und `license` (Lizenz und Quelle – bei
  fremden Dateien immer angeben; nur Dateien aufnehmen, die öffentlich weitergegeben werden dürfen, das Repository
  ist öffentlich).
- Prüfung: Der Server prüft das Manifest beim Start (Aufbau, Längen, doppelte IDs, Pfade nur innerhalb des Ordners –
  auch Symlinks dürfen nicht hinausführen –, Datei vorhanden) und startet bei Fehlern nicht, ebenso wenn der Ordner
  fehlt. Ohne `sounds.json` ist die Bibliothek leer. Änderungen an `sounds.json` übernimmt er ohne Neustart beim
  nächsten Abruf; ist die neue Fassung fehlerhaft oder gelöscht, bleibt die alte Liste aktiv und der Fehler steht im
  Server-Log (der Server versucht es bei jedem Abruf erneut, eine nachgereichte Datei wirkt also sofort).
- Auslieferung: `GET /api/sounds/builtin` liefert `{ sounds: [...] }` im gemeinsamen Soundboard-Format
  (`source: 'builtin'`, `id`, `title`, `url`, dazu `category`, `type`, `durationSec`, `tags`, `license`, `mimeType`;
  Typen in `shared/src/sounds.ts`). Die Dateien selbst liefert der Server unter `/sounds/default/…` statisch aus –
  nur die im Manifest eingetragenen, mit `Cache-Control: max-age` ein Tag und Teilabrufen für das Spulen. Eine Datei
  unter gleichem Namen zu ersetzen wirkt deshalb erst nach bis zu einem Tag – bei echten Änderungen lieber einen
  neuen Dateinamen wählen.
- CDN: `SOUNDS_BASE_URL` (Pfad ab `/` oder `http(s)://`-URL, z.B. `https://cdn.example.org/pnp-sounds/`) auf die
  Kopie des Ordners setzen; die URLs im Manifest zeigen dann dorthin. Das Manifest liest der Server weiterhin aus
  `SOUNDS_DIR`, beides muss also zusammen aktualisiert werden. Das CDN sollte die Dateien mit `Cache-Control` und,
  falls die Seite auf einer anderen Domain läuft, mit CORS-Header (`Access-Control-Allow-Origin`) ausliefern.
- Mitgeliefert sind drei kurze, synthetisch erzeugte Platzhalter (CC0): „Kurze Fanfare“, „Glocke“, „Trommelwirbel“.
  Der Betreiber ersetzt oder ergänzt sie durch echte Dateien.
