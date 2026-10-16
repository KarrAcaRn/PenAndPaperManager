# Soundboard: externe Speicher der Nutzer

Stand: Fundament (Interface, Datenmodell, Registry, API) und Google-Drive-Adapter. Der S3-Adapter und die
Oberfläche bauen darauf auf.

## Ziel

Der Betreiber liefert nur eine kleine Standardbibliothek an Liedern und Sounds aus. Eigene Sounds laden Nutzer in
**ihren eigenen** externen Speicher (S3-Bucket, Google-Drive-Ordner, …), den sie in ihrem Konto verknüpfen.
Unser Server speichert keine Nutzer-Uploads und leitet keine Audiodaten durch: Er vermittelt nur kurzlebige,
signierte URLs, mit denen der Browser direkt beim Anbieter abspielt und hochlädt. Einzige Ausnahme ist die
Wiedergabe aus Google Drive (siehe unten, „Wiedergabe“).

```
Browser ──(1) API: Dateiliste / Playback-URL / Upload-URL──▶ unser Server ──(2) API-Aufruf mit Zugangsdaten──▶ Anbieter
Browser ──(3) GET/PUT direkt mit der signierten URL──────────────────────────────────────────────────────────▶ Anbieter
```

## Bausteine

| Datei | Inhalt |
| --- | --- |
| `shared/src/storage.ts` | API-Typen (`StorageConnection`, `StorageFile`, `PlaybackUrl`, `UploadTarget`, …), Anbieter-Typen, Audio-Endungen/MIME-Types, Limits |
| `server/src/storage/provider.ts` | Interface `StorageProvider`, Bauplan `StorageProviderDefinition`, `StorageProviderError` |
| `server/src/storage/registry.ts` | `StorageProviderRegistry` (providerType → Implementierung), `defaultStorageProviders()` |
| `server/src/storage/connections.ts` | Datenmodell UserStorageConnection: anlegen (`connect`/`createConnection`), lesen, löschen, Status, `withProvider` |
| `server/src/secrets.ts` | Verschlüsselung der Zugangsdaten (AES-256-GCM) und Schlüsselverwaltung |
| `server/src/routes/storage.ts` | HTTP-Endpunkte |
| `server/src/migrations/003_user_storage_connections.sql` | Tabelle `user_storage_connections` |
| `server/test/fakeStorage.ts` | Fake-Anbieter für Tests |
| `server/src/storage/googleDrive.ts` | Google-Drive-Adapter (`GoogleDriveStorageProvider`, `googleDriveProvider`), OAuth-Hilfen, Wiedergabe-Tickets |
| `server/src/routes/googleDrive.ts` | OAuth-Start/-Callback, Ordnerauswahl, Streaming-Endpunkt |
| `server/test/fakeGoogleDrive.ts` | gemockte Google-APIs (Token-Endpunkt, Drive v3, Resumable Upload) |

### StorageProvider

Ein Anbieter wird je Anfrage aus der gespeicherten Verbindung erzeugt (`definition.create(connection)`), er bekommt
`config`, die entschlüsselten `credentials` und `saveCredentials()` zum Speichern erneuerter Tokens.

| Methode | Aufgabe |
| --- | --- |
| `parseInput(config, credentials)` (am Bauplan, optional) | Eingaben beim Anlegen prüfen/normalisieren. Fehlt sie, gibt es nur einen eigenen Flow (OAuth). |
| `validate()` | Verbindung und Rechte prüfen (lesen, auflisten, schreiben). Bildet zusammen mit `parseInput` das „connect“. |
| `listFiles({ folder, cursor, limit })` | Audiodateien (mp3, wav, ogg, m4a) im verbundenen Ordner, seitenweise per Cursor. |
| `getPlaybackUrl(fileId)` | Kurzlebige URL (presigned GET bzw. URL mit kurzlebigem Token), die der Browser direkt abspielt. |
| `upload({ fileName, contentType, size })` | Liefert ein `UploadTarget` für den direkten Upload (presigned PUT/POST, Resumable-Session). Name: `upload`, obwohl kein Byte über unseren Server läuft. |
| `delete(fileId)` | Datei beim Anbieter löschen. |

Pflichten jeder Implementierung:

- Datei-IDs kommen vom Client. Vor jedem Zugriff prüfen, dass die Datei im verbundenen Ordner/Prefix liegt
  (S3: Schlüssel beginnt mit dem Prefix; Drive: Elternordner).
- Fehler als `StorageProviderError(kind, message)` melden. `message` geht an den Nutzer und darf nichts Geheimes
  enthalten. Andere Fehler werden zu „500 Interner Fehler“ und landen im Log – SDK-Fehler also abfangen und übersetzen.
- Zugangsdaten nie loggen, nie in `config` ablegen (wird unverschlüsselt gespeichert und an den Client geliefert).
- Typ und Größe beim Upload nach Möglichkeit in der Signatur festschreiben (S3 presigned POST mit
  `content-length-range`, bzw. Content-Type im signierten PUT).

| `kind` | HTTP | Status der Verbindung |
| --- | --- | --- |
| `invalid` | 400 | unverändert |
| `not_found` | 404 | unverändert |
| `auth` (Zugangsdaten ungültig/widerrufen) | 409 | `disconnected` |
| `permission` (Rechte fehlen, Bucket/Ordner falsch) | 409 | `error` |
| `unavailable` (Anbieter nicht erreichbar, unerwartete Antwort) | 502 | `error` |

Jede erfolgreiche Aktion setzt den Status wieder auf `connected`.

### Neuen Anbieter einbauen

1. Typ in `STORAGE_PROVIDER_TYPES` und `STORAGE_PROVIDER_LABELS` (`shared/src/storage.ts`) ergänzen – keine
   Migration nötig, die Spalte hat bewusst keinen CHECK.
2. `StorageProviderDefinition` implementieren (z.B. `server/src/storage/s3.ts`) und in `defaultStorageProviders()`
   registrieren.
3. Anbieter mit OAuth (Google Drive) haben kein `parseInput`; ihr Callback-Endpunkt ruft nach dem Token-Tausch
   `createConnection(ctx, userId, { providerType, displayName, config, credentials })` auf (nach eigenem `validate`).
   Erneuerte Access-Tokens speichert der Anbieter per `saveCredentials`.

## Datenmodell: `user_storage_connections`

| Spalte | Bedeutung |
| --- | --- |
| `id`, `user_id` | Besitzer; ein Nutzer kann mehrere Verbindungen haben. Löschen des Nutzers löscht sie mit. |
| `provider_type` | `s3`, `google_drive`, … (geprüft vom Server) |
| `display_name` | Anzeigename |
| `config` | JSON, nicht geheim: Bucket/Region/Endpoint/Prefix bzw. Drive-Ordner-ID |
| `credentials` | JSON, verschlüsselt (`v1:<iv>:<tag>:<daten>`, Base64) |
| `status`, `status_message` | `connected` / `error` / `disconnected` und Meldung der letzten Störung |
| `created_at`, `updated_at` | Zeitstempel |

## API

Alle Endpunkte verlangen einen Login und betreffen nur eigene Verbindungen; fremde IDs liefern 404.

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /api/storage/providers` | verfügbare Anbieter (`manualSetup`: per Formular anlegbar) |
| `GET /api/storage/connections` | eigene Verbindungen (ohne Zugangsdaten) |
| `POST /api/storage/connections` | `{ providerType, displayName, config, credentials }` → prüft beim Anbieter, speichert nur bei Erfolg (201) |
| `DELETE /api/storage/connections/:cid` | Verknüpfung entfernen (Dateien beim Anbieter bleiben) |
| `POST /api/storage/connections/:cid/test` | erneut prüfen; liefert die Verbindung, Status wird auch bei Fehler gespeichert |
| `GET /api/storage/connections/:cid/files?folder=&cursor=&limit=` | Audiodateien, `{ files, nextCursor }` |
| `GET /api/storage/connections/:cid/playback-url?fileId=` | `{ url, expiresAt }` |
| `POST /api/storage/connections/:cid/uploads` | `{ fileName, contentType, size }` → `UploadTarget` |
| `DELETE /api/storage/connections/:cid/files?fileId=` | Datei löschen |

Datei-IDs können `/` enthalten (S3-Schlüssel) und stehen deshalb im Query-String statt im Pfad.
`folder` ist relativ zum verbundenen Ordner; `..`, `.`, leere Segmente und `\` lehnt der Server ab.
Uploads: nur mp3/wav/ogg/m4a, Endung und Content-Type müssen zusammenpassen, höchstens
`MAX_STORAGE_UPLOAD_BYTES` (50 MB), Dateiname ohne Ordneranteile.

Ablauf Upload im Browser: Upload-URL holen → Datei per `fetch`/XHR mit `method`, `headers` (PUT) bzw. als
`multipart/form-data` aus `fields` + Datei (POST) direkt an `url` schicken → Dateiliste neu laden.
Ablauf Wiedergabe: Playback-URL holen, `<audio src>` setzen, nach `expiresAt` (bzw. bei Ladefehler) neu holen.

## Sicherheit

- **Zugangsdaten verlassen den Server nie.** Keine API-Antwort enthält `credentials`; der Client bekommt nur
  signierte, kurzlebige URLs für genau eine Datei.
- **Verschlüsselt gespeichert:** AES-256-GCM mit zufälligem IV je Speichervorgang. Als Zusatzdaten (AAD) dienen
  Besitzer und Anbieter, kopierter Geheimtext lässt sich in einer fremden Zeile nicht entschlüsseln.
- **Schlüssel:** `APP_SECRET_KEY` (32 Bytes, Base64, z.B. `openssl rand -base64 32`). Fehlt er, legt der Server
  beim ersten Bedarf `data/secret.key` (Modus 0600) neben der Datenbank an. Schlüssel und Datenbank getrennt
  sichern; ohne Schlüssel sind die Zugangsdaten verloren und die Verbindungen werden als `disconnected` gemeldet
  (Nutzer müssen neu verbinden). Schlüsselrotation ist noch nicht vorgesehen (Format-Präfix `v1` lässt Platz dafür).
- **Rechte minimal halten:** Nutzern empfehlen, eigene Zugangsdaten nur für den einen Bucket/Prefix anzulegen
  (S3: IAM-Policy mit `s3:ListBucket` auf das Prefix, `s3:GetObject`/`PutObject`/`DeleteObject` auf `prefix/*`;
  Drive: Scope `drive.file`).
- **Kein Ausbruch aus dem Ordner:** Ordner-Parameter prüft der Server, Datei-IDs prüft der Anbieter (s.o.).
- **CORS beim Anbieter:** Weil der Browser direkt mit dem Anbieter spricht, muss der Bucket Anfragen von unserer
  Seite erlauben. Für S3 (Beispiel, Origin anpassen; Details liefert der S3-Adapter):

  ```json
  [
    {
      "AllowedOrigins": ["https://pnp.example.org"],
      "AllowedMethods": ["GET", "HEAD", "PUT", "POST"],
      "AllowedHeaders": ["Content-Type", "Content-Length"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```

  Reines Abspielen über `<audio src>` braucht kein CORS; Fortschrittsanzeige beim Upload und `fetch` schon.
  Google Drive erlaubt Resumable-Uploads aus dem Browser, wenn die Session mit passendem `Origin` angelegt wurde.
- **Content-Security-Policy:** Falls die Seite später eine CSP bekommt, müssen `media-src` und `connect-src` die
  Anbieter-Domains erlauben.

## Annahmen

Die ursprüngliche Aufgabenbeschreibung war abgeschnitten; getroffene Annahmen:

1. Verbindungen gehören dem einzelnen Nutzer, nicht einer Gruppe. Teilen mit der Gruppe (z.B. SL spielt eigene
   Sounds für alle ab) ist ein späterer Schritt; die Playback-URL ließe sich dann an die Mitspieler weiterreichen.
2. Login genügt; eine Gruppenmitgliedschaft ist für eigene Speicher nicht nötig.
3. Anlegen speichert nur, was die Prüfung beim Anbieter besteht – so gibt es keine „toten“ Verbindungen von Anfang an.
   Ausfälle danach landen im Status, die Verbindung bleibt erhalten.
4. Löschen einer Verbindung löscht keine Dateien beim Anbieter.
5. Größenlimit für Uploads 50 MB (ausreichend für längere Musikstücke in mp3/ogg).
6. Die Standardbibliothek des Betreibers ist nicht Teil dieses Modells (eigener Manifest-Endpunkt).
7. Eine Datei zählt als Audio, wenn Endung **oder** MIME-Type passt (Drive-Dateien haben nicht immer eine Endung);
   beim Upload müssen beide passen.
8. Ist kein Anbieter eingerichtet, liefert `GET /api/storage/providers` eine leere Liste und das Anlegen antwortet
   mit „Anbieter … ist auf diesem Server nicht verfügbar“. Google Drive erscheint nur mit gesetzten Env-Variablen.

## Google Drive (`google_drive`)

### Einrichtung beim Betreiber

1. In der [Google Cloud Console](https://console.cloud.google.com/) ein Projekt anlegen, die **Google Drive API**
   aktivieren und den OAuth-Zustimmungsbildschirm einrichten (Nutzertyp „Extern“; in der Testphase die eigenen
   Google-Konten als Testnutzer eintragen). Als Scope genügt `…/auth/drive.file` – er gilt als „nicht sensibel“,
   eine Sicherheitsprüfung durch Google ist dafür nicht nötig.
2. Unter „Anmeldedaten“ eine **OAuth-Client-ID vom Typ „Webanwendung“** anlegen und als autorisierte
   Weiterleitungs-URI eintragen: lokal `http://localhost:5173/api/storage/google-drive/oauth/callback` (Vite;
   bei `npm start` Port 3000), in Produktion `https://<domain>/api/storage/google-drive/oauth/callback`.
3. Server mit diesen Variablen starten:

   | Variable | Bedeutung |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | Client-ID (`….apps.googleusercontent.com`) |
   | `GOOGLE_CLIENT_SECRET` | Client-Secret – geheim, nur in der Umgebung, nie im Repository |
   | `GOOGLE_REDIRECT_URI` | exakt die eingetragene Weiterleitungs-URI |
   | `GOOGLE_APP_ORIGIN` (optional) | Origin der Seite für Uploads aus dem Browser; Vorgabe ist der Origin der Redirect-URI |

   Fehlt eine der drei Pflichtvariablen, registriert der Server Google Drive nicht (die Oberfläche bietet es dann
   nicht an).

### Ablauf und Endpunkte

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /api/storage/google-drive/oauth/start?displayName=` | Browser-Navigation (kein `fetch`): leitet zu Google weiter |
| `GET /api/storage/google-drive/oauth/callback` | Rückkehr von Google; legt die Verbindung an und leitet nach `/#/settings?storageConnected=<id>` bzw. `/#/settings?storageError=<Meldung>` weiter |
| `GET /api/storage/google-drive/connections/:cid/folders?cursor=` | Ordner zur Auswahl, `{ folders: [{ id, name }], nextCursor }` |
| `PUT /api/storage/google-drive/connections/:cid/folder` | `{ name: "Soundboard" }` legt den Ordner an, `{ folderId }` wählt einen vorhandenen; liefert die Verbindung |
| `GET /api/storage/google-drive/stream?t=` | Wiedergabe (URL kommt aus `playback-url`, nicht selbst bauen) |

1. **Verbinden:** `start` erzeugt `state` und einen PKCE-Verifier (S256) und legt beides verschlüsselt (an den
   Nutzer gebunden, 10 Minuten gültig) im Cookie `pnp_gdrive_oauth` ab. Google wird mit `access_type=offline` und
   `prompt=consent` aufgerufen, damit immer ein Refresh-Token kommt.
2. **Callback:** prüft Login, Cookie und `state`, löst den Code mit Verifier und Client-Secret ein und verlangt,
   dass `drive.file` gewährt wurde (bei granularer Zustimmung kann der Nutzer das Häkchen abwählen) und ein
   Refresh-Token geliefert wurde. Dann wird die Verbindung **ohne Ordner** angelegt
   (`config = { folderId: null, folderName: null, accountEmail }`), Anzeigename „Google Drive (<E-Mail>)“.
3. **Ordnerauswahl:** Die Oberfläche zeigt nach `storageConnected` die Ordnerauswahl: Ordner anlegen
   (empfohlen, Vorschlag „Soundboard“) oder einen der gelisteten wählen. Die Folder-ID landet in `config.folderId`.
   Bis dahin antworten Dateiaktionen mit 400 „Bitte zuerst einen Google-Drive-Ordner wählen“.

Tokens (`refreshToken`, `accessToken`, `expiresAt`) liegen nur verschlüsselt in `credentials`. Das Access-Token
wird eine Minute vor Ablauf (und einmalig bei einer 401-Antwort) automatisch erneuert und neu gespeichert.
Antwortet Google beim Erneuern mit `invalid_grant` (Nutzer hat der App den Zugriff entzogen, Passwort geändert,
Token abgelaufen), gilt das als `auth` → Verbindung `disconnected`, der Nutzer muss neu verbinden (neue Verbindung,
die alte entfernen). Fehlende Scopes (`insufficientPermissions`) ebenso; Rate-Limits und 5xx sind `unavailable`.

### Warum `drive.file` – und was daraus folgt

`drive.file` gibt der App nur Zugriff auf Dateien und Ordner, die sie **selbst angelegt** hat oder die der Nutzer
ihr über den Google Picker freigibt. Breitere Scopes (`drive`, `drive.readonly`) sind bei Google „eingeschränkt“
und verlangen eine kostenpflichtige Sicherheitsprüfung – für ein Soundboard unverhältnismäßig, und der Nutzer müsste
uns Lesezugriff auf sein ganzes Drive geben.

Für die Ordnerauswahl reicht `drive.file`, weil der empfohlene Weg ist, den Ordner **über die App anzulegen**:

- Ordner und alle über die App hochgeladenen Dateien sind dann für die App sichtbar.
- Die Ordnerliste zeigt nur Ordner, die die App kennt (selbst angelegt oder per Picker freigegeben) – also nicht
  das ganze Drive des Nutzers.
- Dateien, die der Nutzer **direkt in Drive** (Web, Desktop-App) in den Ordner legt, sieht die App mit
  `drive.file` **nicht**. Auch ein per Picker freigegebener vorhandener Ordner gibt nur den Ordner selbst frei,
  nicht seinen Inhalt. Sounds müssen also über das Soundboard hochgeladen werden. Soll später ein bestehender
  Ordner samt Inhalt nutzbar sein, bräuchte es `drive.readonly` (plus Prüfung durch Google) oder die Auswahl
  einzelner Dateien per Picker.
- Optionaler Ausbau: Google Picker im Browser (eigenes, kurzlebiges Token per Google Identity Services, nie von
  unserer API) zur Freigabe eines vorhandenen Ordners; die ID geht dann an `PUT …/folder { folderId }`.

### Dateien

- `listFiles`: Drive-Suche `'<ordner>' in parents and trashed = false and (mimeType contains 'audio/' or
  mimeType = 'application/ogg')`, sortiert nach Name, `pageSize` = `limit`, Cursor = Drive-`nextPageToken`.
  Unterordner (`folder=a/b`) werden per Namen aufgelöst. Dateien, die Drive nicht als Audio erkennt
  (`application/octet-stream`), fehlen – beim Upload über die App setzen wir den MIME-Type immer.
- Datei-IDs vom Client werden geprüft: nur `[A-Za-z0-9_-]`, nicht im Papierkorb, und der verbundene Ordner muss
  unter den Vorfahren sein (höchstens 10 Ebenen). Sonst 404.
- `delete` verschiebt die Datei in den **Papierkorb** des Nutzers (30 Tage wiederherstellbar) statt endgültig zu
  löschen.

### Upload: Resumable-Session

`POST …/uploads` legt beim Server eine
[Resumable-Upload-Session](https://developers.google.com/drive/api/guides/manage-uploads#resumable) an
(`uploadType=resumable`, Metadaten `{ name, parents: [folderId], mimeType }`, `X-Upload-Content-Type` und
`X-Upload-Content-Length` legen Typ und Größe fest) und gibt die Session-URL zurück:

```json
{ "method": "PUT", "url": "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=…",
  "headers": { "Content-Type": "audio/mpeg" }, "fields": {}, "fileId": null, "expiresAt": "…" }
```

Der Browser schickt die Datei per `PUT` direkt dorthin (kein Authorization-Header nötig, die Session-URL selbst
berechtigt nur zu diesem einen Upload, gültig eine Woche). Die Session wird mit `Origin` = `GOOGLE_APP_ORIGIN`
bzw. Origin der Redirect-URI angelegt; nur von diesem Origin erlaubt Google den Upload per CORS. Große Dateien darf
der Client in Stücken (Vielfache von 256 KiB) mit `Content-Range` hochladen und nach Abbrüchen fortsetzen. Die
Datei-ID steht in der Antwort von Google auf den letzten `PUT` (`fileId` ist darum `null`).

### Wiedergabe: Streaming über unseren Server (bewusst gewählt)

Geprüfte Alternativen für eine direkt abspielbare URL:

| Weg | Ergebnis |
| --- | --- |
| `webContentLink` / `drive.google.com/uc?export=download` | Funktioniert nur, wenn der Browser bei Google mit einem berechtigten Konto angemeldet ist (Third-Party-Cookies), leitet um und zeigt bei großen Dateien eine Virenscan-Zwischenseite statt Audio. Für `<audio src>` unzuverlässig. |
| `files/<id>?alt=media&access_token=…` | Drive nimmt Tokens als Query-Parameter seit Januar 2020 nicht mehr an. Zudem stünde das Token in einer API-Antwort und im Browser-Verlauf und gälte eine Stunde für **alle** App-Dateien des Nutzers – ausgeschlossen. |
| Access-Token an den Browser, Download per `fetch` mit Header | Gleiches Problem: Token verlässt den Server. |
| Datei öffentlich freigeben („Jeder mit dem Link“) | Ändert die Freigaben im Drive des Nutzers, Dateien wären dauerhaft öffentlich – ausgeschlossen. |
| **Streaming über unseren Server** | Funktioniert zuverlässig, Token bleibt beim Server. Kostet Bandbreite des Betreibers. |

Darum liefert `getPlaybackUrl` eine URL auf unseren Endpunkt `GET /api/storage/google-drive/stream?t=<ticket>`.
Das Ticket ist signiert (HMAC-SHA256 mit einem aus dem Client-Secret abgeleiteten Schlüssel) und enthält Nutzer,
Verbindung, Datei-ID und Ablauf (1 Stunde); es enthält kein Google-Token. Der Endpunkt holt die Datei mit
`alt=media` und reicht sie als Stream durch – ohne sie zu speichern oder zu puffern. `Range`-Anfragen gehen an
Google weiter (206/416), damit Spulen im Player funktioniert. Antworten tragen `X-Content-Type-Options: nosniff`
und `Content-Security-Policy: sandbox`. Das Ticket braucht kein Session-Cookie, damit später auch Mitspieler einer
Runde dieselbe URL abspielen können; ist der Zugriff widerrufen, antwortet der Endpunkt 409 und die Verbindung wird
`disconnected`.

### Was nie nach außen geht

- Keine API-Antwort und keine Weiterleitung enthält Access-/Refresh-Token, Client-Secret oder Autorisierungscode.
- Anfragen an Google tragen das Token nur im `Authorization`-Header bzw. im POST-Body, nie in der URL.
- Im Request-Log ersetzt der Server die Query-Parameter `code`, `state` und `t` durch `[entfernt]`
  (`redactUrl` in `app.ts`); Fehlermeldungen enthalten keine Antworttexte von Google.
- Tests: `server/test/googleDrive.test.ts` prüft das über alle Antworten und das mitgeschnittene Log.
