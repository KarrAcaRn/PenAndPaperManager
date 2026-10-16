# Soundboard: Funktionsvergleich mit dem Referenz-Soundboard

Stand: 2026-10-16. Verglichen wird unser Soundboard (`#/sounds`) mit dem Soundboard aus dem anderen Projekt.

## Die beiden Implementierungen

| | Referenz („pnp-soundboard“) | Unseres (Pen & Paper Manager) |
| --- | --- | --- |
| Ort | `/opt/data/home/projects/pnp-soundboard` (github.com/KarrAcaRn/pnp-soundboard, Branch `master`, Fork von devp00l) | dieses Repo, Seite `#/sounds` |
| Technik | eine HTML-Seite, jQuery + Bootstrap 3, Web Audio API (`AudioContext`, `AudioBufferSourceNode`, `GainNode`) | Svelte 5, je Sound ein `HTMLAudioElement` |
| Logik | `js/board.js` (alles global, ~1440 Zeilen) | `client/src/lib/soundPlayer.svelte.ts`, `client/src/lib/soundboard.ts` |
| Oberfläche | `index.html`, `css/custom.css` | `client/src/routes/Soundboard.svelte` |
| Sound-Quelle | Ordner `sounds/<kategorie>/<datei>`, `generateSoundJson.js` erzeugt `sounds.json`, `start-server.js` liefert aus (Range-Requests) | Standard-Sounds des Betreibers (`server/sounds/default/sounds.json`, `server/src/sounds.ts`, `server/src/routes/sounds.ts`) und Dateien im eigenen Speicher der Nutzer (S3/Google Drive, `server/src/storage/`, `server/src/routes/storage.ts`) |
| Tests | `spec/board.spec.js` (Jest, 45 Fälle) | `client/test/soundboard.test.ts`, `client/test/soundboardPage.test.ts`, `server/test/s3.test.ts`, `server/test/googleDrive.test.ts` |

Zeilenangaben `board.js:NNN` beziehen sich auf `pnp-soundboard/js/board.js` im Stand `08936c7`.

## Architektur unseres Soundboards

*Stand vor dem Nachbau (Ausgangslage der Analyse); den heutigen Stand beschreiben die Spalte „Unseres“ der
Funktionstabelle, die Abschnitte „Umsetzung“ und der Paritätsbericht am Ende.*

**Daten**

- `shared/src/sounds.ts`: `BuiltinSound` (`id`, `title`, `category`, `url`, `durationSec`, `tags`, `license`,
  `mimeType`). Kategorie, Dauer und Tags kommen aus dem Manifest, werden in der Oberfläche aber nur teilweise genutzt
  (Kategorie ja, Tags und Dauer nein).
- `shared/src/storage.ts`: `StorageConnection`, `StorageFile`, `PlaybackUrl`, Upload-Typen, erlaubte Endungen
  (mp3, wav, ogg, m4a) und `MAX_STORAGE_UPLOAD_BYTES` (50 MB).
- `client/src/lib/soundboard.ts`: `BoardSound` – gemeinsame Kachel-Form für beide Quellen (`key`, `source`, `id`,
  `title`, `category`, `url`, `deletable`). Nutzer-Dateien haben keine Kategorie (`category: null`).
- Server: Standard-Sounds über `GET /api/sounds/builtin` (öffentlich) plus statische Dateien unter `/sounds/default/`;
  Nutzer-Dateien über `GET /api/storage/connections/:cid/files` (seitenweise), `…/playback-url`, `POST …/uploads`
  (direkter Upload zum Anbieter), `DELETE …/files`. Verbindungen in Tabelle `user_storage_connections`
  (Migration `006`), Details in `docs/soundboard-storage.md`.

**Wiedergabe** (`client/src/lib/soundPlayer.svelte.ts`, `createPlayer`)

- Je Kachel ein eigenes `Audio`-Element (`audios`-Map), Zustand je Kachel `loading`/`playing`, Fehlertexte je Kachel.
- Ein globaler Lautstärkeregler (`setVolume`, 0…1) für alle Sounds, Modus „exklusiv“ (`setExclusive`): ein neuer
  Sound stoppt alle anderen, sonst laufen beliebig viele parallel.
- `toggle` startet/stoppt eine Kachel, `stopAll` stoppt alles. Sounds laufen einmal durch, keine Schleife.
- Abgelaufene Playback-URLs werden einmal neu geholt (`createPlaybackUrlCache`).
- Persistenz: nur `volume` und `exclusive` in `localStorage` (`pnp.soundboard`).

**Oberfläche** (`client/src/routes/Soundboard.svelte`)

- Steuerleiste: Suche (Titel, mehrere Wörter, ohne Akzente), Quelle (Alle/Standard/Verbindung), Kategorie (nur
  Standard-Sounds), Lautstärke, „Mehrere Sounds gleichzeitig“, „Alle stoppen“.
- Upload-Bereich (Ziel-Speicher wählen, Datei-Dialog oder Drag & Drop, Fortschritt je Datei, Prüfung vor dem Upload).
- Kachelraster: Standard-Sounds nach Kategorie gruppiert, darunter je Speicher-Verbindung eine Sektion mit
  „Aktualisieren“ und „Weitere laden“; eigene Dateien löschbar.
- Kein Tastatur-Kürzel, keine Playlist, keine Unterscheidung Musik/Effekt.

## Architektur der Referenz (Kurzfassung)

- Bibliothek links/rechts getrennt: rechts die **Bibliothek** (Kategorie-Tabs + Suche, Kacheln mit Hotkey-Badge),
  links zwei **Playlisten**: „Background music“ und „Effects“.
- Ein Klick auf einen Bibliotheks-Sound spielt ihn **nicht** direkt ab, sondern öffnet einen Dialog „Background
  music / Effects / Cancel“ (`playSound` → `openAddSoundModal`, `board.js:334–380`). Der **Typ Musik/Effekt ist
  also keine Eigenschaft des Sounds, sondern der Playlist**, in die er gelegt wird; derselbe Sound kann in beiden
  Listen stehen.
- Audiograph: `source → item-gain → master-gain(bg|fx) → destination` (`ensureMasterGains`, `board.js:166`;
  `playBackgroundIndex`, `board.js:989`; `startEffect`, `board.js:1091`). Dateien werden erst beim Hinzufügen
  geladen und dekodiert und dann im `BufferLoader` gecacht (`board.js:50–138`, `getBufferFromPath`, `board.js:321`).
- Playlisten leben nur im Speicher der Seite (Arrays `backgroundPlaylist`, `effectsPlaylist`), nichts wird gespeichert.

## Funktionstabelle

Status „unseres“: **ja** = vorhanden, **teilweise** = vorhanden, aber deutlich schwächer, **nein** = fehlt.
„Nicht in der Referenz“ markiert Punkte aus der Aufgabenliste, die die Referenz gar nicht hat – sie gehören nicht
zum Nachbau.

### Musik und Effekte

| # | Funktion | Referenz (Datei / Funktion) | Unseres |
| --- | --- | --- | --- |
| 1 | **Trennung Hintergrundmusik / Effekte**: zwei getrennte Bereiche; beim Klick auf einen Sound wählt man per Dialog, ob er in die Musik- oder Effekt-Playlist kommt (Esc oder Klick auf den Hintergrund bricht ab) | `index.html` `#add-sound-modal`; `playSound`, `openAddSoundModal`, `closeAddSoundModal`, `onAddSoundModalBackdrop`, `addPendingToBackground`, `addPendingToEffects` (`board.js:330–380`); Esc in `document.onkeydown` (`board.js:1414`) | **erledigt, bewusst anders** – der Typ (`sfx`/`music`) ist eine Eigenschaft des Sounds: Vorgabe aus dem Manifest (`type`), je Kachel und beim Upload umstellbar, gespeichert; ein Klick spielt sofort auf dem passenden Kanal, „+“ legt Musik in eine Playlist, Umschalter „Alle / Hintergrundmusik / Effekte“. Kein Hinzufügen-Dialog (Begründung im Paritätsbericht) |
| 2 | **Musik exklusiv**: im Musikkanal läuft immer genau ein Titel; Start eines anderen stoppt den vorherigen | `playBackgroundIndex` stoppt per `stopBackgroundSource` (`board.js:959`, `989`), Token `backgroundPlayToken` verwirft veraltete Ladevorgänge | ja – Musikkanal in `createPlayer` (`play` stoppt den laufenden bzw. ladenden Titel, Generationszähler verwirft veraltete Ladevorgänge), Schleife per „Musik wiederholen“ |
| 3 | **Effekte überlagern sich**: beliebig viele Effekte gleichzeitig und parallel zur Musik | `startEffect`, `effectNodes` je Eintrag (`board.js:1091`) | ja – Effektkanal, unabhängig vom Musikkanal |
| 4 | **Master-Lautstärke Musik** (Start 70 %) | `setBackgroundMasterVolume` → `backgroundMasterGain` (`board.js:747`), Slider `#bg-master-volume` | ja – Regler „Musik“ (Start 70 %), dazu Gesamtlautstärke; gespeichert |
| 5 | **Master-Lautstärke Effekte** (Start 100 %) | `setEffectsMasterVolume` → `effectsMasterGain` (`board.js:760`), Slider `#fx-master-volume` | ja – Regler „Effekte“ (Start 100 %); gespeichert |
| 6 | **Lautstärke je Effekt** (Slider pro Eintrag, 0–100) | `setEffectItemVolume` (`board.js:773`), Slider in `renderEffectsPlaylist` (`board.js:713`) | **erledigt** – Lautstärke-Regler je Kachel (Faktor zu Gesamt- × Kanallautstärke, wirkt sofort, gespeichert; `soundSettings.svelte.ts`) |
| 7 | **Effekte starten bei Lautstärke 0** und laufen sofort (zum Einblenden per Slider – die Referenz-Variante von „Fade-in“) | `addToEffectsPlaylist` setzt `volume: 0` und ruft `startEffect` (`board.js:402`) | bewusst nein – setzt die Effekt-Liste voraus (siehe „Offene Punkte“); auf Kacheln hieße es „Klick, und man hört nichts“ |
| 8 | **Endlosschleife je Effekt** (Schalter „Endless“, Standard an, wirkt auch während der Wiedergabe) | `toggleEffectLoop` setzt `source.loop` (`board.js:1168`), Vorgabe `loop: true` in `addToEffectsPlaylist` | **erledigt** – Schalter „⟳“ je Kachel, wirkt auch während der Wiedergabe, gespeichert; Standard aus (siehe unten) |
| 9 | **Effekt einzeln starten/stoppen** (Play/Stop-Knopf je Eintrag, Zustand sichtbar) | `toggleEffectPlayback`, `isEffectPlaying` (`board.js:1151–1166`) | ja – Kachel-Toggle (`player.toggle`) |
| 10 | **Effekt entfernen** (stoppt ihn) | `removeEffectItem` (`board.js:1181`) | offen – keine Effekt-Liste; Stoppen geht über die Kachel bzw. „Effekte stoppen“ (siehe „Offene Punkte“) |
| 11 | **Effekte neu anordnen** per Drag & Drop, nur am Griff (wegen Slider/Knöpfen) | `reorderEffectsPlaylist`, `bindEffectDrag`, `bindPlaylistDrag`, `ensureDragDisarm` (`board.js:881–957`) | offen – keine Effekt-Liste; die Kachel-Reihenfolge kommt aus Kategorie/Ordner und bestimmt die Tasten (siehe „Offene Punkte“) |

### Playlist Hintergrundmusik

| # | Funktion | Referenz (Datei / Funktion) | Unseres |
| --- | --- | --- | --- |
| 12 | **Playlist anlegen/füllen**: Titel aus der Bibliothek anhängen, Duplikate erlaubt; der erste Titel startet automatisch | `addToBackgroundPlaylist` (`board.js:387`) | **erledigt** – „+“ auf Musik-Kacheln hängt an die gewählte Playlist an (ohne Playlist entsteht eine), Duplikate erlaubt; der erste Titel startet sofort, sofern keine Musik läuft |
| 13 | **Automatisch weiter**: am Titelende folgt der nächste, nach dem letzten wieder der erste (Wiederholen der ganzen Liste ist fest eingebaut) | `onBackgroundTrackEnded` (`board.js:1053`) | **erledigt** – „Wiederholen: alle“ ist Vorgabe (`nextTrack` in `playlistQueue.ts`, `ended` in `playlists.svelte.ts`) |
| 14 | **Play/Pause** mit Fortsetzen an der gemerkten Stelle | `toggleBackgroundPlayback`, `pauseBackgroundPlayback`, `startBackgroundPlayback` (`board.js:804–836`), `#bg-play-pause` | **erledigt** – `player.pause`/`player.resume` behalten das Audio-Element und damit die Stelle |
| 15 | **Nächster Titel** (Skip) | `skipBackgroundTrack` (`board.js:838`), `#bg-skip` | **erledigt** – „Nächster Titel“, dazu „Vorheriger Titel“ (nicht in der Referenz) |
| 16 | **Zu Titel springen** per Doppelklick | `jumpToBackgroundItem` (`board.js:847`), `ondblclick` in `renderBackgroundPlaylist` | **erledigt** – Doppelklick auf die Zeile, per Tastatur Klick auf den Namen |
| 17 | **Titel entfernen**; trifft es den laufenden, spielt der nächste, bei leerer Liste ist Ruhe | `removeBackgroundItem` (`board.js:1061`) | **erledigt** – `afterRemove`; angehalten bleibt angehalten |
| 18 | **Reihenfolge per Drag & Drop** (ganze Zeile greifbar), laufender Titel bleibt aktuell | `reorderBackgroundPlaylist`, `movePlaylistItem`, `bindBackgroundDrag` (`board.js:856–894`) | **erledigt** – Drag & Drop der Zeile und ↑/↓; Einträge haben eigene IDs, der laufende bleibt der laufende |
| 19 | **Fortschrittsbalken** mit Zeit `m:ss / m:ss` beim laufenden Titel, alle 250 ms aktualisiert | `createBackgroundProgress`, `updateBackgroundProgress`, `formatPlayTime`, `backgroundElapsed` (`board.js:511–666`) | **erledigt** – Schieberegler „Position im Titel“ mit `formatPlayTime`, alle 250 ms |
| 20 | **Spulen**: Klick oder Ziehen im Balken; im Pausenzustand wird nur die Startposition gesetzt | `startBackgroundSeek`, `seekBackgroundToRatio`, `seekBackgroundTo` (`board.js:546–602`) | **erledigt** – `player.seek`, auch angehalten |
| 21 | **Markierung des laufenden/ladenden/fehlerhaften Titels** (`is-current`, `is-loading`, `is-error`) | `renderBackgroundPlaylist` (`board.js:452`) | **erledigt** – Zeile mit `aria-current`, Symbol ♪/…/❚❚, Fehlertext am Titel, „(nicht verfügbar)“ für nicht geladene Sounds |
| 22 | Shuffle | nicht in der Referenz | **erledigt** – „Zufall“: jeder Titel einmal je Durchgang, neuer Durchgang beginnt nicht mit dem letzten |
| 23 | Wiederholen aus / einzelnen Titel wiederholen | nicht in der Referenz (Liste wiederholt immer, Musiktitel selbst nie in Schleife) | **erledigt** – „Wiederholen“ aus / alle (Vorgabe) / einen Titel |
| 24 | Fades/Crossfades zwischen Musiktiteln, Fade-out beim Stoppen | nicht in der Referenz (harter Wechsel; einziges „Einblenden“ ist #7) | bewusst nein – harter Wechsel wie in der Referenz |
| 25 | Mehrere benannte Playlisten | nicht in der Referenz (genau eine Musik- und eine Effektliste) | **erledigt** – anlegen, umbenennen, löschen, Auswahl |

### Bibliothek, Suche, Kategorien

| # | Funktion | Referenz (Datei / Funktion) | Unseres |
| --- | --- | --- | --- |
| 26 | **Kategorien aus Ordnern**, auch verschachtelt (`packs/rain` → „PACKS / RAIN“), als Tabs | `generateSoundJson.js`; `gotSoundJson`, `createCategoryTabs`, `createCategoryTab`, `catLabel` (`board.js:219`, `1281–1308`, `314`) | **erledigt** – Kategorie-Leiste statt Auswahlliste über alle angezeigten Quellen; Unterordner im eigenen Speicher werden Kategorien („packs / regen“, `fileCategory`). Google Drive listet weiter nur den verbundenen Ordner ohne Unterordner (siehe unten) |
| 27 | **Kategorie wechseln** per Knöpfen und Pfeil links/rechts, ringsum | `nextCat`, `previousCat`, `setCurrentCat` (`board.js:1361–1374`), `#previous-cat`/`#next-cat` | **erledigt** – Knöpfe ‹ › und Pfeil links/rechts, ringsum („Alle“ gehört zur Reihe) |
| 28 | **Suche** über alle Kategorien, mehrere Wörter (UND), trifft den ganzen Pfad (also auch den Kategorienamen); Treffer in eigenem Tab „SEARCH“ mit eigenen Hotkeys | `search`, `searchTerm`, `createSearchSoundButtons` (`board.js:245–259`, `1331`); `init` bindet `#search` | **erledigt** – sucht in Titel, Kategorie/Ordner und Schlagwörtern (UND, ohne Akzente); bei aktiver Suche über alle Kategorien, Bereich „Suche“ in der Kategorie-Leiste, eigene Tasten; Suche leeren führt zur gewählten Kategorie zurück |
| 29 | **Markierung „in einer Playlist“** auf Bibliotheks-Kacheln | `refreshLibraryMarks`, Klasse `in-playlist` (`board.js:416–428`) | **erledigt** – Kacheln in einer Playlist haben ☰ und einen Akzent-Rahmen |
| 30 | **Lange Titel kürzen** (> 33 Zeichen → „…“, voller Name im Tooltip) | `createSoundButton` (`board.js:1254`) | ja – anderer Weg: Umbruch im Kachelraster |
| 31 | Tags | nicht in der Referenz | **erledigt** (soweit sinnvoll) – Schlagwörter werden durchsucht (`BoardSound.tags`) |
| 32 | Favoriten, Farben je Sound | nicht in der Referenz | nein |

### Tastatur

| # | Funktion | Referenz (Datei / Funktion) | Unseres |
| --- | --- | --- | --- |
| 33 | **Dynamische Hotkeys je Kategorie**: Kacheln bekommen der Reihe nach `0–9`, `a–z`, `A–Z` (62 Plätze) als Badge; die Taste löst die Kachel im aktuellen Tab aus (öffnet also den Hinzufügen-Dialog) | `generateListOfHotKeys`, `createHotkeyElements`, `createBadge`, `createCategoryButttonBadges`, `hotButton` (`board.js:261–298`, `1376`) | **erledigt** – `soundHotkeys.ts`: sichtbare Kacheln in Anzeigereihenfolge, Taste als Abzeichen und `aria-keyshortcuts`; die Taste wirkt wie ein Klick (`activate`). |
| 34 | **Pfeil hoch/runter**: Musik-Lautstärke ±1 | `volumeChange`, `keyBindings` (`board.js:1383–1407`) | **erledigt** – ±1 % auf die Musik-Lautstärke (`onKeydown`, Fall `volume`) |
| 35 | **Alt**: Fokus ins Suchfeld; Tippen im Suchfeld wechselt in den Such-Tab | `keyBindings[ALT]`, `document.onkeydown` (`board.js:1406`, `1424–1428`) | **erledigt** – Alt fokussiert das Suchfeld; Tippen dort zeigt den Bereich „Suche“ |
| 36 | **Esc** schließt den Hinzufügen-Dialog; solange er offen ist, sind alle anderen Hotkeys aus | `document.onkeydown` (`board.js:1414–1422`) | **erledigt, soweit anwendbar** – es gibt keinen Hinzufügen-Dialog (#1); Kürzel sind aus, solange ein `dialog[open]` oder `[aria-modal="true"]` offen ist, Esc schließt solche Dialoge selbst |
| 37 | **Hotkeys aus beim Tippen** in Eingabefeldern | `document.onkeydown` (`board.js:1424`) | **erledigt** – aus in input, textarea, select, contenteditable und mit Strg/Cmd |
| 38 | Frei belegbare Hotkeys je Sound | nicht in der Referenz (nur positionsabhängig) | nein |

### Stoppen, Laden, Fehler

| # | Funktion | Referenz (Datei / Funktion) | Unseres |
| --- | --- | --- | --- |
| 39 | **Alle stoppen** | `stopAllEffects` (`board.js:1188`) stoppt alle Effekte – in der Oberfläche **nicht** verdrahtet; Musik nur per Pause | ja – „Alle stoppen“ (`player.stopAll`), dazu „Musik stoppen“ und „Effekte stoppen“ (`player.stopChannel`); stoppt auch beim Verlassen der Seite |
| 40 | **Lazy Loading + Puffer-Cache**: Datei erst beim Hinzufügen laden/dekodieren, danach gecacht | `BufferLoader.prototype.loadBuffer`, `decodeAudioBuffer`, `getBufferFromPath` (`board.js:57–138`, `321`) | teilweise – Laden erst beim Abspielen, Cache nur für Playback-URLs (`createPlaybackUrlCache`), Browser-Cache für die Datei |
| 41 | **AudioContext bei Interaktion entsperren** | `ensureAudio` (`board.js:148`) | ja (anderer Weg) – `audio.play()` im Klick, Meldung bei `NotAllowedError` |
| 42 | **Ladefehler je Eintrag** sichtbar, ohne Absturz | `catch` in `playBackgroundIndex` (`board.js:1042`) und `startEffect` (`board.js:1121`), Klasse `is-error` | ja – Fehlertext je Kachel, einmaliger Neuversuch mit frischer URL |

### Import, Speicherung, Sonstiges

| # | Funktion | Referenz (Datei / Funktion) | Unseres |
| --- | --- | --- | --- |
| 43 | **Sounds hinzufügen**: Dateien in `sounds/<kategorie>/` legen, `npm start` erzeugt `sounds.json` | `generateSoundJson.js`, `package.json` Skript `updateSounds` | ja, und mehr – Standard-Sounds per Manifest; Upload in eigenen S3-/Drive-Speicher mit Fortschritt, Drag & Drop, Löschen (`Soundboard.svelte`, `lib/upload.ts`) |
| 44 | **Auslieferung mit HTTP-Range**, Symlinks, Schutz vor Pfad-Traversal | `soundsMiddleware` in `start-server.js` | ja – `@fastify/static` mit `allowedPath` (`server/src/routes/sounds.ts`), Speicher-Anbieter liefern selbst |
| 45 | **Eigener Titel** der Seite | `js/customizations.json` (`title`), `init` (`board.js:233`) | nein – fest „Soundboard“ (für uns unwichtig) |
| 46 | **Persistenz** | keine: Playlisten, Lautstärken und Schleifen gehen beim Neuladen verloren | **erledigt** (mehr als die Referenz) – Gesamt-, Musik- und Effektlautstärke, „Musik wiederholen“, Typ je Sound (`pnp.soundboard.types`) sowie Lautstärke/Schleife je Sound (`pnp.soundboard.sounds`) in `localStorage`; Playlisten samt gewählter Playlist, Zufall und Wiederholen unter `pnp.soundboard.playlists` |
| 47 | **Zweispaltiges Layout**: Playlisten links, Bibliothek rechts | `index.html` `.app-layout`, `css/custom.css` | **erledigt** – ab 72rem Breite Playlisten links (mitlaufend), Bibliothek rechts; schmal untereinander (`.layout` in `Soundboard.svelte`) |
| 48 | Import/Export der Board-Konfiguration | nicht in der Referenz | nein |
| 49 | Mehrere Quellen, Anmeldung, eigener Speicher, Löschen, „Weitere laden“ | nicht in der Referenz | ja (nur bei uns) |

## Empfohlene Reihenfolge

Grundsatz: wie die Referenz modellieren – **Musik/Effekt ist der Kanal bzw. die Playlist, in die ein Sound gelegt
wird, kein festes Feld am Sound**. Die Manifest-Kategorie („Musik“/„Effekte“) taugt höchstens als Vorauswahl im
Dialog. Ein `type`-Feld am Sound wäre eine Abweichung von der Referenz; wer es trotzdem einführt, sollte es nur als
Vorschlag für den Dialog nutzen.

1. **Wiedergabe-Kern mit zwei Kanälen** (#2–#5, #8, #39): Umstieg auf Web Audio (oder `Audio` + `GainNode` über
   `createMediaElementSource`) mit Master-Gain je Kanal; Musik exklusiv, Effekte parallel; Schleife je Effekt;
   „Alle stoppen“ für beide Kanäle. Lautstärken und Schleifen in `localStorage` (unser Mechanismus).
   Für lange Musiktitel `Audio`-Elemente statt komplett dekodierter Puffer erwägen (Speicher, Startzeit).
2. **Hinzufügen-Dialog und Zweiteilung der Seite** (#1, #29, #36, #47): Klick auf Kachel → „Hintergrundmusik /
   Effekte / Abbrechen“, Markierung „in Playlist“, Playlisten-Spalte neben der Bibliothek.
3. **Effekt-Liste** (#6, #7, #9–#11): Start bei Lautstärke 0, Slider je Eintrag, Play/Stop, Schleife, Entfernen,
   Reihenfolge am Griff.
4. **Musik-Playlist** (#12–#21): automatisch weiter mit Wiederholung, Play/Pause mit Fortsetzen, Skip, Doppelklick,
   Entfernen, Drag & Drop, Fortschritt und Spulen. Danach entscheiden, ob Playlisten über das Neuladen hinaus
   gespeichert werden (Referenz: nein; sinnvoll wäre `localStorage` mit Sound-`key`s).
5. **Kategorien und Suche** (#26–#28): Kategorie-Tabs mit Vor/Zurück, Unterordner der eigenen Speicher als
   Kategorien, Suche auch über Kategorie (und Tags), eigener Treffer-Bereich.
6. **Tastatur** (#33–#37): Hotkeys `0–9a–zA–Z` je sichtbarer Kategorie mit Badges, Pfeile für Kategorie und
   Musik-Lautstärke, Alt für die Suche, Esc für den Dialog, alles aus beim Tippen und bei offenem Dialog.
7. Optional, nicht in der Referenz: Crossfade/Fade-out, Shuffle, Wiederhol-Modi, mehrere benannte Playlisten,
   Favoriten, Export/Import (#22–#25, #32, #48).

## Umsetzung: übrige Funktionen (Aufgabe t_734df2df)

Umgesetzt wurden alle Punkte mit „nein“/„teilweise“ außer den drei Bereichen, die eigene Aufgaben haben: Trennung
Musik/Effekte samt Dialog und Zweiteilung (#1–#3, #36, #47 → t_38ef2508), Kanal-Lautstärken (#4, #5 →
t_38ef2508) und Playlisten (#12–#25, #29 → t_9ae3600d). In der Tabelle oben steht „**erledigt**“ beim jeweiligen
Punkt.

**Erledigt**

| # | Funktion | Wo |
| --- | --- | --- |
| 6 | Lautstärke je Sound | Regler auf jeder Kachel; `client/src/lib/soundSettings.svelte.ts`, Player-Option `soundOptions`, `player.refreshSound` |
| 8 | Endlosschleife je Sound | Schalter „⟳“ auf jeder Kachel, wirkt sofort; ebenda |
| 26 | Kategorien aus Ordnern | `fileCategory` in `client/src/lib/soundboard.ts`; Kategorie-Leiste in `Soundboard.svelte`; Speicher-Sektionen nach Ordner gruppiert |
| 27 | Kategorie wechseln | Knöpfe ‹ › und Pfeil links/rechts (`stepCategory`) |
| 28 | Suche über Titel, Kategorie, Schlagwörter, Bereich „Suche“ | `filterSounds` (`searchText`), `activeCategory` in `Soundboard.svelte` |
| 31 | Schlagwörter | werden durchsucht (`BoardSound.tags`) |
| 33 | Tasten 0–9, a–z, A–Z je sichtbarem Bereich | `client/src/lib/soundHotkeys.ts` (`assignHotkeys`, `hotkeyAction`) |
| 34 | Pfeil hoch/runter: Musik-Lautstärke ±1 % | `onKeydown`, Fall `volume` → `player.setVolume('music', …)` |
| 35 | Alt: Suchfeld | `hotkeyAction` → `search` |
| 37 | Kürzel aus beim Tippen | `isTypingTarget` |

Gespeichert wird wie bisher in `localStorage`: Lautstärke und Schleife je Sound unter `pnp.soundboard.sounds`
(Schlüssel ist der Sound-`key`, nur Abweichungen vom Standard). Beim Löschen einer eigenen Datei wird ihr Eintrag
entfernt. Tests: `client/test/soundboard.test.ts` (Tastatur, Einstellungen je Sound, Player, Ordner-Kategorien,
Suche) und `client/test/soundboardPage.test.ts` (Kategorie-Leiste, Bereich „Suche“, Tastatur, Dialog-Sperre,
Einstellungen nach dem Neuladen, Unterordner).

**Hinweise für die Aufgaben Musik/Effekte und Playlisten**

- Kachel-Klick und Kachel-Taste laufen beide über `activate(sound)` in `Soundboard.svelte`. Wenn der Klick den
  Hinzufügen-Dialog öffnen soll, nur `activate` ändern; die Tasten folgen dann von selbst (wie in der Referenz).
- Die Kürzel sind aus, solange `dialog[open]` oder `[aria-modal="true"]` im Dokument steht (`modalOpen`). Esc
  schließt der Dialog selbst (bei `<dialog>` macht der Browser das).
- Pfeil hoch/runter ändern die Musik-Lautstärke (`onKeydown`, Fall `volume`).
- Lautstärke und Schleife je Sound kommen über `createPlayer({ soundOptions })` und `player.refreshSound(key)` in
  den Player (`applyOptions`: Gesamt- × Kanal- × Sound-Lautstärke; Schleife = Angabe beim Start, sonst eigene
  Schleife, bei Musik auch „Musik wiederholen“). In der Effekt-Liste der Referenz sind es genau diese Werte je
  Eintrag (#6, #8).
- Für Playlisten: `player.play(sound, { channel: 'music', loop: false })` spielt einen Titel auf dem Musikkanal
  ohne Schleife, `createPlayer({ onEnded })` meldet das natürliche Ende (nicht bei Stopp) zum Weiterschalten.

**Bewusst ausgelassen**

| # | Funktion | Grund |
| --- | --- | --- |
| 7 | Effekte starten bei Lautstärke 0 | Ergibt nur in der Effekt-Liste der Referenz Sinn, in der der Regler direkt neben dem laufenden Eintrag steht. Auf unseren Kacheln hieße das: Klick, und man hört nichts. Gehört zur Effekt-Liste (Aufgabe Musik/Effekte); die Schleife steht deshalb auch standardmäßig auf aus. |
| 10, 11 | Effekt entfernen, Effekte neu anordnen | setzen die Effekt-Liste voraus, die mit dem Hinzufügen-Dialog kommt (Aufgabe Musik/Effekte bzw. Playlisten) |
| 26 (Drive) | Unterordner bei Google Drive | Drive listet nur direkte Kinder eines Ordners. Rekursives Auflisten braucht eine Änderung am Server-Anbieter (`googleDrive.ts` `listFiles`, Ordnerpfade, seitenweises Laden über mehrere Ordner). S3 liefert Unterordner schon heute. Kann bei Bedarf eine eigene Aufgabe werden. |
| 32 | Favoriten, Farben je Sound | nicht in der Referenz |
| 38 | Frei belegbare Tasten je Sound | nicht in der Referenz (dort hängen die Tasten an der Position) |
| 40 | Puffer-Cache mit dekodierten Dateien | bewusst anders: `Audio`-Elemente mit Browser-Cache und Playback-URL-Cache; ganze Musikstücke zu dekodieren kostet viel Speicher und Startzeit |
| 45 | Eigener Seitentitel | für uns unwichtig; das Aussehen passt der Betreiber über Themes an |
| 48 | Import/Export der Konfiguration | nicht in der Referenz |

## Umsetzung: Playlisten (Aufgabe t_9ae3600d)

Umgesetzt sind #12–#25 (außer #24) und #29, in der Tabelle oben als „**erledigt**“ markiert.

| Teil | Wo |
| --- | --- |
| Warteschlange ohne Oberfläche: weiter, zurück, Zufall, Wiederholen, Entfernen, Verschieben | `client/src/lib/playlistQueue.ts` (`nextTrack`, `previousTrack`, `afterRemove`, `moveItem`) |
| Playlisten speichern (`pnp.soundboard.playlists`) | `createPlaylists` in `client/src/lib/playlists.svelte.ts` |
| Wiedergabe auf dem Musikkanal | `createPlaylistPlayer` ebenda; spielt per `player.play(sound, { channel: 'music', loop: false })`, schaltet über `createPlayer({ onEnded })` weiter |
| Pause/Fortsetzen, Position, Spulen | `pause`, `resume`, `position`, `seek` in `client/src/lib/soundPlayer.svelte.ts` (neuer Zustand `paused`) |
| Oberfläche | Abschnitt „Playlisten“ und „+“ auf Musik-Kacheln in `client/src/routes/Soundboard.svelte` |

Entscheidungen:

- **Mehrere benannte Playlisten** statt der einen Liste der Referenz; ein Eintrag ist `{ id, sound, title }` (eigene ID,
  damit Duplikate und Umsortieren sicher sind; `title` zeigt den Namen, solange der Sound noch nicht geladen ist).
- **Gespeichert im Browser** wie die übrigen Soundboard-Einstellungen (das Soundboard geht auch ohne Login); nach
  dem Neuladen sind Playlisten, Auswahl, Zufall und Wiederholen wieder da, die Wiedergabe startet aber nicht von
  selbst (das ließe der Browser ohne Klick ohnehin nicht zu).
- **Wiederholen „alle“ ist Vorgabe** (Verhalten der Referenz), dazu „aus“ und „einen Titel“. Bei „einen Titel“
  wiederholt das Titelende, „Weiter“ schaltet trotzdem um. **Zufall** spielt jeden Titel einmal je Durchgang;
  „Zurück“ geht dann zum zuvor gespielten.
- **Kein Crossfade**: harter Wechsel wie in der Referenz.
- **Effekte** laufen über der Playlist (eigener Kanal). Musik per Kachel ersetzt den Playlist-Titel, dessen Ende
  schaltet dann nicht mehr weiter; „Abspielen“ setzt beim gemerkten Titel wieder ein. „Musik stoppen“ und „Alle
  stoppen“ beenden die Playlist.
- **Ladefehler** eines Titels: Fehlertext am Titel, die Playlist bleibt stehen (wie in der Referenz). Titel, deren
  Sound gar nicht verfügbar ist (Speicher nicht geladen, Datei weg), werden übersprungen.
- **Gelöschte Datei**: verschwindet aus allen Playlisten; lief sie gerade, spielt der nächste Titel.
- Ein Musik-Sound, der auf „Effekt“ umgestellt wird, bleibt in seinen Playlisten und spielt dort weiter auf dem
  Musikkanal. Ein laufender Sound stoppt beim Typwechsel nur noch, wenn er auf dem anderen Kanal läuft.

Tests: `client/test/playlists.test.ts` (Warteschlange, Speichern, Wiedergabe mit dem echten Player) und
`client/test/soundboardPage.test.ts` (Bereich „Soundboard: Playlisten“, Löschen einer Datei aus einer Playlist).

Offen: #47 (Playlisten-Spalte neben der Bibliothek) – die Playlisten stehen als eigener Abschnitt über den Kacheln.
→ mit t_0fc28287 erledigt, siehe unten.

## Offene Punkte

| Punkt | Worum es geht | Warum offen |
| --- | --- | --- |
| Effekt-Liste (#7, #10, #11) | Die Referenz legt Effekte in eine eigene Liste: Start bei Lautstärke 0 zum Einblenden, Entfernen, Umsortieren am Griff. | Bei uns sind die Kacheln selbst die Effekt-Steuerung (Start/Stopp, Lautstärke und Schleife je Kachel, „Effekte stoppen“). Eine zusätzliche Effekt-Liste („Szene“: zusammengestellte Effekte mit eigenen Reglern) ist ein eigenes Feature mit Oberfläche, Speicherung und Tastenbelegung – zu groß für diese Prüfaufgabe. Bei Bedarf eigene Aufgabe. |
| Unterordner bei Google Drive (#26) | Kategorien aus Unterordnern gehen bei S3, bei Drive nur der verbundene Ordner. | Braucht rekursives Auflisten im Server-Anbieter (`server/src/storage/googleDrive.ts`, `listFiles`). |
| Echte Wiedergabe aus S3/Drive im Browser | Im Browser geprüft wurde mit den Standard-Sounds; Dateien aus eigenem Speicher nur in den Client-Tests (gemockte API). | In der Prüfumgebung gibt es keinen erreichbaren S3-/Drive-Speicher. |
| `Soundboard.svelte` aufteilen | Die Seite hat ~900 Zeilen (Playlisten, Upload, Kacheln, Tastatur). | Reiner Umbau ohne Verhaltensänderung; sinnvoll vor der nächsten größeren Soundboard-Erweiterung (z.B. Komponente `PlaylistPanel`). |

## Paritätsbericht (Aufgabe t_0fc28287, 2026-10-16)

**Prüfung**

- `npm test` (shared 32, server 366 + 4 übersprungen, client 355), `npm run check` (0 Fehler, 0 Warnungen) und
  `npm run build` laufen fehlerfrei.
- Im echten Browser (Chromium, Vorschau-Instanz) mit echter Audio-Wiedergabe der Standard-Sounds; die Referenz lief
  daneben (`start-server.js`, Port 8081) zum Vergleich der Bedienung. Geprüft wurden:
  - **Effekt über laufender Playlist**: Taste `1` (Glocke) während der Playlist – beide Audio-Elemente laufen, die
    Playlist schaltet am Titelende normal weiter.
  - **Musikwechsel**: Musik per Kachel ersetzt den Playlist-Titel (harter Wechsel, Playlist zeigt „Gestoppt“ und
    setzt mit „Abspielen“ wieder ein); ein auf „Musik“ umgestellter Effekt läuft auf dem Musikkanal.
  - **Kanal-Lautstärken**: Musik 0,8 × 0,7 = 0,56 am Audio-Element, Pfeil hoch → 0,568 (Musik 71 %, gespeichert),
    Effekte auf 50 % → Glocke 0,4; Playlist-Titel ohne Schleife.
  - **Pause/Fortsetzen**: angehaltener Titel bleibt an derselben Stelle, Fortsetzen spielt dort weiter.
  - **Zufall und Wiederholen**: „alle“ beginnt nach dem letzten Titel von vorn, „aus“ hört danach auf; Zufall und
    Wiederholen werden gespeichert.
  - **Neuladen**: Playlisten, Auswahl, Zufall, Wiederholen, Typen und Lautstärken sind danach wieder da.
  - **Altdaten**: `pnp.soundboard = { volume: 0.3, exclusive: true }` → Gesamt 30 %, Musik 70 %, Effekte 100 %;
    kaputtes `pnp.soundboard.playlists` → leere Playlisten statt Absturz.
  - **Löschen eines Sounds aus einer Playlist** (nur mit eigenem Speicher möglich): per Client-Test
    (`soundboardPage.test.ts` „nimmt eine gelöschte Datei aus allen Playlisten …“) – der Eintrag verschwindet aus
    allen Playlisten, lief er gerade, spielt der nächste.
  - Layout bei 1500, 1000 und 420 px Breite ohne horizontales Scrollen.

**Behoben**

- **Aktualisieren eines Speichers** leerte die Dateiliste bis zur Antwort. Endete in dieser Zeit ein Playlist-Titel,
  galten die Titel dieses Speichers als „nicht verfügbar“ und wurden übersprungen (im schlimmsten Fall hielt die
  Playlist an). Jetzt bleibt die alte Liste stehen, bis die neue da ist (`loadFiles`). Test: „behält beim
  Aktualisieren eines Speichers die Titel laufender Playlisten“.
- **#47 Zweispaltiges Layout** wie in der Referenz: Playlisten links, Bibliothek rechts; schmal untereinander. Test:
  „stellt die Playlisten wie in der Referenz neben die Bibliothek“.
- Das Namensfeld der Playlist ragte in schmalen Spalten in den Knopf „Playlist löschen“ (`min-width: 0`).

**Ergebnis**

Alle 49 Punkte haben einen Status: vorhanden bzw. erledigt (#2–#6, #8, #9, #12–#23, #25–#31, #33–#35, #37, #39,
#41–#44, #46, #47, #49), bewusst anders mit Begründung (#1 Typ am Sound statt Dialog, #24 kein Crossfade, #36 ohne
eigenen Dialog, #40 Audio-Elemente statt dekodierter Puffer, #45 Titel über Themes), nicht in der Referenz und
deshalb nicht nachgebaut (#32, #38, #48) oder offen mit Grund (#7, #10, #11 Effekt-Liste; Drive-Teil von #26).

Der wichtigste bewusste Unterschied: In der Referenz öffnet ein Klick auf einen Sound den Dialog „Background music /
Effects“, der Typ hängt an der Liste. Bei uns hat jeder Sound einen Typ und ein Klick spielt sofort – am Spieltisch
ist das ein Klick statt zwei, und Tasten lösen Sounds direkt aus. Musik kommt über „+“ in eine Playlist.
