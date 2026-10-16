# AGENTS.md – Pen & Paper Manager

Webseite für Pen&Paper-Gruppen (FATE-System). Fachliche Regeln stehen in der `README.md` – vor Änderungen an
Rechten, Sichtbarkeit oder Ordnern lesen.

## Aufbau

npm-Workspaces, alles TypeScript (ESM, Imports mit `.ts`-Endung):

- `shared/` – Typen (`types.ts`), Pfad-Logik (`path.ts`), Limits und Zeichenklassen. Wird von Server und Client
  direkt als Quelltext importiert (`@pnp/shared`), kein Build-Schritt.
- `server/` – Node 24+, Fastify 5, SQLite über eingebautes `node:sqlite` (`DatabaseSync`), gestartet mit `tsx`.
  - `app.ts` baut die App (`buildApp(db)`), `index.ts` startet sie.
  - `routes/*.ts` – je Ressource eine Funktion `xxxRoutes(app, db)`.
  - `access.ts` – Sichtbarkeits-/Bearbeitungsregeln, dazu die SQL-Entsprechung (`VISIBLE_ARTICLE_SQL`).
  - `auth.ts` – Sessions (30 Tage, `createSession`/`destroySession`), globaler API-Guard `requireAuthForApi`,
    `requireUser`/`requireMember`/`requireGm`. Login per E-Mail-Code in `login-codes.ts` + `routes/login-codes.ts`.
  - `schemas.ts` – JSON-Schema-Bausteine für die Fastify-Validierung.
  - `migrations/NNN_name.sql` – werden beim Start automatisch in Dateinamen-Reihenfolge angewendet.
  - `storage/` – externe Speicher fürs Soundboard (`StorageProvider`, Registry, Verbindungen), `secrets.ts`
    verschlüsselt Zugangsdaten. Siehe `docs/soundboard-storage.md`.
- `client/` – Svelte 5 (Runes, `*.svelte.ts` für reaktiven Zustand), Vite, eigener Router (`lib/router.svelte.ts`),
  API-Zugriff nur über `lib/api.ts`. Markdown-Anzeige via `marked` + `DOMPurify` (`lib/markdown.ts`), Bearbeiten im WYSIWYG-Editor TipTap
  (`lib/MarkdownEditor.svelte`, speichert Markdown, wird per dynamischem Import nachgeladen).

## Befehle

```sh
npm ci --include=dev   # in dieser Umgebung nötig: NODE_ENV=production lässt sonst devDependencies weg
npm run dev            # Server :3000 + Vite :5173 (Vite proxyt /api)
npm test               # shared + server (In-Memory-DB) + client (jsdom), Vitest
npm run check          # tsc (Server) + svelte-check (Client) – muss fehlerfrei sein
npm run build && npm start
```

Umgebungsvariablen: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (`data/app.db`); Mailversand (`server/src/mail.ts`)
über `MAIL_TRANSPORT`, `SMTP_*`, `MAIL_FROM` – siehe `.env.example`. Ohne SMTP wird außerhalb von Produktion nur geloggt.
`APP_SECRET_KEY` (sonst `data/secret.key`), `S3_ALLOW_PRIVATE_ENDPOINTS` (`1` = S3-Endpoints im LAN erlauben).

## Konventionen

- **Sprache:** UI-Texte, Fehlermeldungen, Kommentare und Commit-Messages auf Deutsch. Bezeichner auf Englisch.
- **Fehler:** im Server nur über die Helfer aus `errors.ts` werfen (`notFound`, `forbidden`, `gmOnly`,
  `conflict`, `badRequest`, …); der zentrale Error-Handler macht daraus `{ error: string }`.
- **Datenbank:** nur über `getRow`/`allRows`/`run`/`insertRow`/`transaction` aus `db.ts` – das sind die einzigen
  Stellen, an denen DB-Zeilen typisiert werden. Mehrschrittige Änderungen in `transaction()`. Tabellen/Spalten in
  `snake_case`, API-Objekte in `camelCase`.
- **Schemaänderungen:** neue Migrationsdatei mit nächster Nummer anlegen, bestehende Migrationen nie ändern.
- **Eingaben:** jede Route validiert Body und Params per Schema (`objectOf`, `nonBlank`, `idParams`, …).
  Längenlimits gehören nach `shared`, damit Client und Server dieselben Werte nutzen.
- **Rechte:** Sichtbarkeitslogik immer in `access.ts` halten und JS- und SQL-Variante gemeinsam ändern.
  Invarianten aus der README (mindestens ein Spielleiter, verwaiste private Artikel gehen an die Spielleiter)
  nicht brechen.
- **Stil:** 2 Leerzeichen, einfache Anführungszeichen, Semikolons, Trailing Commas, lange Zeilen (~120) sind ok.

## Tests

- Jede Verhaltensänderung bekommt einen Test. Server-Tests laufen gegen `buildApp(openDb(':memory:'))` per
  `app.inject` – Helfer in `server/test/helpers.ts` (`makeApp`/`testApp` mit abgefangenem Mailversand und ohne
  Rate-Limits, `loginAs`/`loginWithCode` über den echten Code-Login, `setupGroup`, `article`).
- Client-Tests mit `@testing-library/svelte` in jsdom; Hilfen in `client/test/helpers.ts`.
- Vor jedem Commit: `npm test` und `npm run check` grün.

## Git

- Branch `main`, Remote `origin` = github.com/KarrAcaRn/PenAndPaperManager.
- Commit-Messages: kurz, Deutsch, beschreibend im Infinitiv/Imperativ (z.B. „Sonderfälle … beheben“).
- `data/`, `dist/`, `coverage/`, `node_modules/` sind ignoriert und werden nie committet.
