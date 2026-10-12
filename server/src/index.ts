import { openDb } from './db.ts';
import { buildApp } from './app.ts';
import { dbPath, rulebookDir } from './paths.ts';

const path = dbPath();
const port = Number(process.env.PORT ?? 3000);

const app = buildApp(openDb(path), { logger: true, rulebookDir: rulebookDir(path) });
app.listen({ port, host: process.env.HOST ?? '127.0.0.1' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
