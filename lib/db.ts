import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'fs';
import path from 'path';
import * as schema from '@/db/schema';
import { getEnv } from './env';

export type Db = BetterSQLite3Database<typeof schema>;

// Singleton über globalThis, damit Next-Dev-Reloads keine zweite Verbindung öffnen
const g = globalThis as unknown as { __voDb?: Db; __voSqlite?: Database.Database };

/** Liefert die DB-Instanz (legt Verzeichnisse an, wendet Migrationen beim ersten Zugriff an). */
export function getDb(): Db {
  if (g.__voDb) return g.__voDb;

  const dataDir = path.resolve(getEnv().DATA_DIR);
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });

  const sqlite = new Database(path.join(dataDir, 'app.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'db/migrations') });

  g.__voSqlite = sqlite;
  g.__voDb = db;
  return db;
}

export function getSqlite(): Database.Database {
  getDb();
  return g.__voSqlite as Database.Database;
}

export { schema };
