import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { encrypt } from './crypto';

// Frisches DATA_DIR mit dem Stand VOR Paket 6 (Migrationen 0000–0005), Altdaten mit einem Einzel-Postfach in den
// Einstellungen; danach startet lib/db wie im Betrieb: Migration 0006 + Übernahme des alten Postfachs.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-uebernahme-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SEND_MIN_GAP_MINUTES: '3',
  SEND_MAX_GAP_MINUTES: '9',
});
delete process.env.SENDER_EMAIL;
delete process.env.SENDER_NAME;

const T0 = new Date('2026-07-15T09:00:00Z'); // Mittwoch 11:00 Berlin
const TAG = 24 * 3600_000;
const LEGACY_TOKEN = encrypt('legacy-refresh-token');

type Mods = { db: typeof import('./db'); loop: typeof import('./send-loop'); absender: typeof import('./absender'); env: typeof import('./env'); uebernahme: typeof import('./absender-uebernahme'); settings: typeof import('./settings') };
let m: Mods;

/** Migrationsordner mit nur den Migrationen vor Paket 6 */
function altesMigrationsverzeichnis(): string {
  const quelle = path.resolve(process.cwd(), 'db/migrations');
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-mig-alt-'));
  fs.mkdirSync(path.join(ziel, 'meta'));
  const journal = JSON.parse(fs.readFileSync(path.join(quelle, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => !e.tag.startsWith('0006_'));
  expect(journal.entries.length).toBeGreaterThan(0);
  fs.writeFileSync(path.join(ziel, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries) fs.copyFileSync(path.join(quelle, `${e.tag}.sql`), path.join(ziel, `${e.tag}.sql`));
  return ziel;
}

beforeAll(async () => {
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  const sqlite = new Database(path.join(dir, 'app.db'));
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: altesMigrationsverzeichnis() });
  expect(sqlite.prepare("select count(*) as n from sqlite_master where name = 'absender'").get()).toEqual({ n: 0 });

  // Altdaten: ein Postfach in den Einstellungen, zwei gesendete Leads (einer mit offenem Follow-up), ein geplanter
  const setting = sqlite.prepare('insert into settings (key, value) values (?, ?)');
  setting.run('gmail_refresh_token', LEGACY_TOKEN);
  setting.run('gmail_email', 'Legacy@Prozessia.de');
  setting.run('gmail_scopes', 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata');
  setting.run('sender_name', 'Amin Douioui');
  setting.run('signature', 'Globale Signatur');
  setting.run('global_daily_limit', '45');
  setting.run('rampe_beginn', '2026-06-01');
  setting.run('send_state', JSON.stringify({ date: '2026-07-14', sentToday: 3, nextSendAt: 1_800_000_000_000, quotaStoppedDate: '2026-07-14' }));
  sqlite.prepare("insert into campaigns (name, email_subject_template, email_body_template, cta_url, status, mit_video) values ('Alt', 'Hallo {{firma}}', 'Text {{absender_name}}', 'https://x.de', 'versendet_laufend', 0)").run();
  sqlite.prepare("insert into followups (campaign_id, position, wait_days, body) values (1, 1, 1, 'Nachgehakt')").run();
  const lead = sqlite.prepare(
    'insert into leads (campaign_id, firma, email, slug, render_status, send_status, sent_at, gmail_thread_id, gmail_message_id, rfc_message_id) values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const vorZweiTagen = T0.getTime() - 2 * TAG;
  lead.run('Alt 1', 'a1@kunde.de', 'alt-1', 'fertig', 'gesendet', vorZweiTagen, 'thread-1', 'msg-1', '<1@prozessia.de>');
  lead.run('Alt 2', 'a2@kunde.de', 'alt-2', 'fertig', 'gesendet', vorZweiTagen, 'thread-2', 'msg-2', '<2@prozessia.de>');
  lead.run('Alt 3', 'a3@kunde.de', 'alt-3', 'fertig', 'geplant', null, null, null, null);
  const mail = sqlite.prepare('insert into sent_messages (lead_id, campaign_id, step, gmail_message_id, gmail_thread_id, sent_at) values (?, 1, 0, ?, ?, ?)');
  mail.run(1, 'msg-1', 'thread-1', vorZweiTagen);
  mail.run(2, 'msg-2', 'thread-2', vorZweiTagen);
  sqlite.close();

  // Start wie im Betrieb
  m = {
    db: await import('./db'),
    loop: await import('./send-loop'),
    absender: await import('./absender'),
    env: await import('./env'),
    uebernahme: await import('./absender-uebernahme'),
    settings: await import('./settings'),
  };
  m.db.getDb();
});

describe('Übernahme des alten Einzel-Postfachs (Migration 0006 auf Bestandsdaten)', () => {
  it('legt das Postfach aus den Alt-Einstellungen an', () => {
    const alle = m.absender.ladeAbsender();
    expect(alle).toHaveLength(1);
    expect(alle[0]).toMatchObject({
      email: 'legacy@prozessia.de',
      name: 'Amin Douioui',
      refreshTokenEnc: LEGACY_TOKEN,
      scopes: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata',
      tageslimit: 45, // das bisherige globale Limit galt für dieses eine Postfach
      aktiv: true,
      signatur: null, // null = globale Signatur
      fehler: null,
      rampeBeginn: '2026-06-01',
      nextSendAt: 1_800_000_000_000,
      quotaGestopptAm: '2026-07-14',
    });
    expect(m.absender.kannAntwortenPruefen(alle[0])).toBe(true);
  });

  it('ordnet gesendete Leads und Mails zu, lässt Ungesendetes unberührt', () => {
    const { getDb, schema } = m.db;
    const id = m.absender.ladeAbsender()[0].id;
    const leads = getDb().select().from(schema.leads).all();
    expect(leads.map((l) => [l.slug, l.absenderId])).toEqual([
      ['alt-1', id],
      ['alt-2', id],
      ['alt-3', null],
    ]);
    expect(getDb().select().from(schema.sentMessages).all().map((x) => x.absenderId)).toEqual([id, id]);
  });

  it('die Einstellungsseite zeigt das übernommene Postfach mit Status und Tagesstand', async () => {
    const { ladeEinstellungen } = await import('./settings-view');
    const e = ladeEinstellungen();
    expect(e.postfaecher).toHaveLength(1);
    expect(e.postfaecher[0]).toMatchObject({ email: 'legacy@prozessia.de', name: 'Amin Douioui', verbunden: true, aktiv: true, antwortPruefung: true, tageslimit: 45, leads: 2 });
    expect(['aktiv', 'heute_gestoppt']).toContain(e.postfaecher[0].status);
    expect(e.signature).toBe('Globale Signatur');
  });

  it('entfernt die alten Schlüssel, behält die Standardwerte und ist idempotent', () => {
    const { getDb, schema } = m.db;
    const keys = getDb().select().from(schema.settings).all().map((s) => s.key).sort();
    expect(keys).toEqual(['global_daily_limit', 'rampe_beginn', 'sender_name', 'signature']);
    expect(m.uebernahme.uebernehmeAltesPostfach(getDb())).toBeNull();
    expect(m.absender.ladeAbsender()).toHaveLength(1);
  });

  it('laufende Follow-ups des Altbestands gehen weiter über das übernommene Postfach', async () => {
    const id = m.absender.ladeAbsender()[0].id;
    const gesendet: { postfachId: number; threadId?: string; raw: string }[] = [];
    const geprueft: number[] = [];
    const sender = async (raw: string, threadId: string | undefined, p: { id: number }) => {
      gesendet.push({ postfachId: p.id, threadId, raw: Buffer.from(raw, 'base64url').toString('utf8') });
      return { id: `neu-${gesendet.length}`, threadId: threadId ?? 'x' };
    };
    const pruefer = async (_t: string, p: { id: number }) => (geprueft.push(p.id), null);
    // Der alte Quota-Stopp (14.07.) und Abstand (weit in der Zukunft!) werden übernommen: heute nach dem Abstand testen
    m.absender.setzeNaechstenVersand(id, 0);
    const r = await m.loop.runSendTick({ sender, pruefer, now: T0, zufall: () => 0 });
    expect(r.sent).toBe(1);
    expect(gesendet[0].postfachId).toBe(id);
    expect(gesendet[0].threadId).toMatch(/^thread-[12]$/);
    expect(gesendet[0].raw).toContain('From: "Amin Douioui" <legacy@prozessia.de>');
    expect(gesendet[0].raw).toContain('In-Reply-To: <');
    expect(geprueft).toContain(id);
    const f = m.db.getDb().select().from(m.db.schema.sentMessages).where(eq(m.db.schema.sentMessages.step, 1)).all();
    expect(f).toHaveLength(1);
    expect(f[0].absenderId).toBe(id);
  });
});

describe('uebernehmeAltesPostfach (Randfälle)', () => {
  const setze = (key: string, value: string) => m.db.getDb().insert(m.db.schema.settings).values({ key, value }).onConflictDoUpdate({ target: m.db.schema.settings.key, set: { value } }).run();

  it('ohne bekannte Adresse bleibt alles unverändert und wird später nachgeholt (SENDER_EMAIL)', () => {
    const { getDb, schema } = m.db;
    setze('gmail_refresh_token', encrypt('zweiter-token'));
    setze('gmail_scopes', 'https://www.googleapis.com/auth/gmail.send');
    m.env.resetEnvCache();
    expect(m.uebernahme.uebernehmeAltesPostfach(getDb())).toBeNull();
    expect(getDb().select().from(schema.settings).where(eq(schema.settings.key, 'gmail_refresh_token')).get()).toBeTruthy();
    expect(m.absender.ladeAbsender()).toHaveLength(1);

    process.env.SENDER_EMAIL = 'zweit@prozessia.de';
    m.env.resetEnvCache();
    const u = m.uebernahme.uebernehmeAltesPostfach(getDb());
    expect(u).toMatchObject({ email: 'zweit@prozessia.de', leads: 0, mails: 0 });
    expect(m.absender.ladeAbsender().map((a) => a.email)).toEqual(['legacy@prozessia.de', 'zweit@prozessia.de']);
    expect(getDb().select().from(schema.settings).where(eq(schema.settings.key, 'gmail_refresh_token')).get()).toBeUndefined();
    delete process.env.SENDER_EMAIL;
    m.env.resetEnvCache();
  });

  it('bei vorhandener Adresse wird kein Duplikat angelegt', () => {
    const { getDb } = m.db;
    setze('gmail_refresh_token', encrypt('dritter'));
    setze('gmail_email', 'LEGACY@prozessia.de');
    const u = m.uebernahme.uebernehmeAltesPostfach(getDb());
    expect(u?.email).toBe('legacy@prozessia.de');
    expect(m.absender.ladeAbsender().filter((a) => a.email === 'legacy@prozessia.de')).toHaveLength(1);
    // Der bestehende, verbundene Eintrag behält seinen Token
    expect(m.absender.ladeAbsender()[0].refreshTokenEnc).toBe(LEGACY_TOKEN);
  });
});
