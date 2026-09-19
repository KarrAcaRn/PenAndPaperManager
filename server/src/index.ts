import { join } from 'node:path';
import { openDb } from './db.ts';
import { buildApp } from './app.ts';

const dbPath = process.env.DB_PATH ?? join(import.meta.dirname, '../../data/app.db');
const port = Number(process.env.PORT ?? 3000);

const app = buildApp(openDb(dbPath), { logger: true });
app.listen({ port, host: process.env.HOST ?? '127.0.0.1' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
