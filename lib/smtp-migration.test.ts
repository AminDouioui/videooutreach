import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, describe, expect, it } from 'vitest';

// Stand VOR Paket 16 (Migrationen 0000–0014) mit einem Gmail-Postfach; danach startet lib/db wie im Betrieb und
// führt 0015 aus: der Bestand muss unverändert als Gmail-Postfach weiterlaufen.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-smtp-mig-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
});

function altesMigrationsverzeichnis(): string {
  const quelle = path.resolve(process.cwd(), 'db/migrations');
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-mig-p15-'));
  fs.mkdirSync(path.join(ziel, 'meta'));
  const journal = JSON.parse(fs.readFileSync(path.join(quelle, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => Number(e.tag.slice(0, 4)) < 15);
  fs.writeFileSync(path.join(ziel, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.join(quelle, `${e.tag}.sql`), path.join(ziel, `${e.tag}.sql`));
  return ziel;
}

beforeAll(() => {
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  const sqlite = new Database(path.join(dir, 'app.db'));
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: altesMigrationsverzeichnis() });
  const spalten = sqlite.prepare("select name from pragma_table_info('absender')").all() as { name: string }[];
  expect(spalten.map((s) => s.name)).not.toContain('typ');
  sqlite.prepare("insert into absender (email, name, refresh_token_enc, scopes, tageslimit) values ('alt@prozessia.de', 'Alt', 'enc-token', 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata', 25)").run();
  sqlite.close();
});

describe('Migration 0015 (SMTP/IMAP-Postfächer)', () => {
  it('Bestandspostfach bleibt ein unverändertes Gmail-Postfach (Default „gmail“)', async () => {
    const { getDb, schema } = await import('./db');
    const a = getDb().select().from(schema.absender).get()!;
    expect(a).toMatchObject({ email: 'alt@prozessia.de', name: 'Alt', refreshTokenEnc: 'enc-token', tageslimit: 25, aktiv: true, typ: 'gmail', zugangsdatenEnc: '', smtpHost: null, imapHost: null, imapKopieGesendet: true });
    const { postfachVerbunden, kannAntwortenPruefen, kannThreadLesen } = await import('./absender');
    expect(postfachVerbunden(a)).toBe(true);
    expect(kannAntwortenPruefen(a)).toBe(true);
    expect(kannThreadLesen(a)).toBe(false);
    const { treiberFuer } = await import('./postfach-treiber');
    expect(treiberFuer(a).typ).toBe('gmail');
  });
  it('typ lässt nur gmail/smtp zu (Typ-Aufzählung im Schema) und neue Spalten sind nullbar', async () => {
    const { getDb, schema } = await import('./db');
    const neu = getDb().insert(schema.absender).values({ email: 'smtp@x.de', typ: 'smtp', smtpHost: 'h', smtpPort: 25, smtpSicherheit: 'keine' }).returning().get();
    expect(neu).toMatchObject({ typ: 'smtp', smtpSicherheit: 'keine', refreshTokenEnc: '', zugangsdatenEnc: '' });
  });
});
