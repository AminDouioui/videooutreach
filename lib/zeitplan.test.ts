import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-zeitplan-'));
Object.assign(process.env, {
  DATA_DIR: dir,
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
  APP_URL: 'https://video.example.de',
  SENDER_EMAIL: 'amin@prozessia.de',
  SEND_MIN_GAP_MINUTES: '3',
  SEND_MAX_GAP_MINUTES: '9',
});

type Mods = {
  db: typeof import('./db');
  loop: typeof import('./send-loop');
  send: typeof import('./send');
  sup: typeof import('./suppression');
  settings: typeof import('./settings');
  campaigns: typeof import('./campaigns');
  importServer: typeof import('./import-server');
};
let m: Mods;
let nr = 0;

// Mittwoch 15.07.2026 11:00 Berlin
const T0 = new Date('2026-07-15T09:00:00Z');
const tag = (n: number) => new Date(T0.getTime() + n * 24 * 3600_000);
const zufall = () => 0;
const sender = async (_raw: string, threadId?: string) => ({ id: `m${++nr}`, threadId: threadId ?? `t${nr}` });
const nichtSenden = async () => {
  throw new Error('darf nicht senden');
};

type KampagneWerte = Partial<typeof import('@/db/schema').campaigns.$inferInsert>;

function neueKampagne(werte: KampagneWerte = {}) {
  const { getDb, schema } = m.db;
  const [k] = getDb()
    .insert(schema.campaigns)
    .values({ name: 'T', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}\n\n{{vorschaubild}}', status: 'versendet_laufend', dailySendLimit: 50, ...werte })
    .returning()
    .all();
  return k;
}
function neuerLead(campaignId: number, email?: string, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  const n = ++nr;
  const [l] = getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${n}`, email: email ?? `l${n}@x${n}.de`, slug: `z${n}`, renderStatus: 'fertig', sendStatus: 'geplant', ...extra })
    .returning()
    .all();
  return l;
}
function leadStatus(id: number) {
  const { getDb, schema } = m.db;
  return getDb().select().from(schema.leads).where(eq(schema.leads.id, id)).get();
}

beforeAll(async () => {
  m = {
    db: await import('./db'),
    loop: await import('./send-loop'),
    send: await import('./send'),
    sup: await import('./suppression'),
    settings: await import('./settings'),
    campaigns: await import('./campaigns'),
    importServer: await import('./import-server'),
  };
  m.db.getDb();
});

beforeEach(() => {
  // Jeder Test startet ohne laufende Kampagnen, ohne Rampe und ohne Abstandssperre
  const { getDb, schema } = m.db;
  getDb().update(schema.campaigns).set({ status: 'pausiert' }).run();
  getDb().delete(schema.sentMessages).run();
  m.settings.setSetting('send_state', '{}');
  m.settings.setSetting('global_daily_limit', '100');
  m.settings.setSetting('rampe_aktiv', '0');
  m.settings.deleteSetting('rampe_beginn');
});

describe('Migration', () => {
  it('Standard-Versandtage Mo–Fr, kein Startdatum, keine Neue-Leads-Grenze', () => {
    const k = neueKampagne();
    expect(k.sendDays).toBe('1,2,3,4,5');
    expect(k.startDatum).toBeNull();
    expect(k.maxNeueLeadsProTag).toBeNull();
  });

  it('Backfill: send_weekdays_only → send_days', () => {
    const { getSqlite } = m.db;
    const sqlite = getSqlite();
    // Backfill-Statement der Migration auf zwei Testzeilen anwenden
    const sql = fs.readFileSync(path.resolve(process.cwd(), 'db/migrations/0005_zeitplan_zustellbarkeit.sql'), 'utf8');
    const update = sql.split('--> statement-breakpoint').map((x) => x.trim()).find((x) => x.startsWith('UPDATE'));
    expect(update).toBeTruthy();
    const nurWerktage = neueKampagne({ sendWeekdaysOnly: true, sendDays: 'x' });
    const alleTage = neueKampagne({ sendWeekdaysOnly: false, sendDays: 'x' });
    sqlite.exec(update as string);
    const { getDb, schema } = m.db;
    const lies = (id: number) => getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get()?.sendDays;
    expect(lies(nurWerktage.id)).toBe('1,2,3,4,5');
    expect(lies(alleTage.id)).toBe('1,2,3,4,5,6,7');
  });
});

describe('Versandtage und Startdatum in der Schleife', () => {
  it('Samstag nur bei freigegebenem Versandtag', async () => {
    const sa = new Date('2026-07-18T09:00:00Z');
    const werktags = neueKampagne();
    neuerLead(werktags.id);
    const r1 = await m.loop.runSendTick({ sender: nichtSenden, now: sa });
    expect(r1.waiting).toContain(`${werktags.id}:fenster_zu`);

    m.db.getDb().update(m.db.schema.campaigns).set({ status: 'pausiert' }).run();
    const samstags = neueKampagne({ sendDays: '6,7' });
    const l = neuerLead(samstags.id);
    const r2 = await m.loop.runSendTick({ sender, now: sa, zufall });
    expect(r2.sent).toBe(1);
    expect(leadStatus(l.id)?.sendStatus).toBe('gesendet');
  });

  it('vor dem Startdatum wird nicht gesendet, am Startdatum schon', async () => {
    const k = neueKampagne({ startDatum: '2026-07-16' });
    const l = neuerLead(k.id);
    const r1 = await m.loop.runSendTick({ sender: nichtSenden, now: T0 });
    expect(r1.sent).toBe(0);
    expect(r1.waiting).toContain(`${k.id}:vor_start`);
    const r2 = await m.loop.runSendTick({ sender, now: tag(1), zufall });
    expect(r2.sent).toBe(1);
    expect(leadStatus(l.id)?.sendStatus).toBe('gesendet');
  });
});

describe('Neue Leads pro Tag', () => {
  it('begrenzt Erstmails, fällige Follow-ups gehen trotzdem raus', async () => {
    const { getDb, schema } = m.db;
    const k = neueKampagne({ maxNeueLeadsProTag: 1 });
    getDb().insert(schema.followups).values({ campaignId: k.id, position: 1, waitDays: 1, body: 'Kurz nachgehakt' }).run();
    // Lead A: Erstmail vor 2 Tagen, Follow-up fällig
    const a = neuerLead(k.id, undefined, { sendStatus: 'gesendet', sentAt: tag(-2), gmailThreadId: 'tA', gmailMessageId: 'mA', rfcMessageId: '<a@x>' });
    getDb().insert(schema.sentMessages).values({ leadId: a.id, campaignId: k.id, step: 0, sentAt: tag(-2) }).run();
    const b = neuerLead(k.id);
    const c = neuerLead(k.id);

    const pruefer = async () => null;
    const abstand = (n: number) => new Date(T0.getTime() + n * 10 * 60_000);

    // 1. Durchlauf: fälliges Follow-up hat Vorrang vor neuen Leads
    const r1 = await m.loop.runSendTick({ sender, pruefer, now: abstand(0), zufall });
    expect(r1.sent).toBe(1);
    expect(leadStatus(a.id)?.followupsSent).toBe(1);
    // 2. Durchlauf: erste neue Erstmail (zählt zum Limit)
    const r2 = await m.loop.runSendTick({ sender, pruefer, now: abstand(1), zufall });
    expect(r2.sent).toBe(1);
    expect(leadStatus(b.id)?.sendStatus).toBe('gesendet');
    // 3. Durchlauf: Limit 1 neuer Lead erreicht, kein Follow-up fällig → Erstmail an C wartet
    const r3 = await m.loop.runSendTick({ sender: nichtSenden, pruefer, now: abstand(2), zufall });
    expect(r3.sent).toBe(0);
    expect(r3.waiting).toContain(`${k.id}:limit_neue_leads`);
    expect(leadStatus(c.id)?.sendStatus).toBe('geplant');
    // Am nächsten Tag darf der nächste neue Lead raus
    const r4 = await m.loop.runSendTick({ sender, pruefer, now: tag(1), zufall });
    expect(r4.sent).toBe(1);
    expect(leadStatus(c.id)?.sendStatus).toBe('gesendet');
  });

  it('countSentToday(nurErstmails) zählt nur step 0', () => {
    const { getDb, schema } = m.db;
    const k = neueKampagne();
    const l = neuerLead(k.id);
    const jetzt = new Date('2026-08-12T09:00:00Z');
    getDb().insert(schema.sentMessages).values([
      { leadId: l.id, campaignId: k.id, step: 0, sentAt: jetzt },
      { leadId: l.id, campaignId: k.id, step: 1, sentAt: jetzt },
    ]).run();
    expect(m.send.countSentToday(k.id, jetzt)).toBe(2);
    expect(m.send.countSentToday(k.id, jetzt, true)).toBe(1);
  });
});

describe('Aufwärmrampe', () => {
  it('begrenzt das globale Tageslimit und steigt täglich', async () => {
    m.settings.setSetting('global_daily_limit', '30');
    m.settings.setSetting('rampe_aktiv', '1');
    m.settings.setSetting('rampe_start', '2');
    m.settings.setSetting('rampe_schritt', '1');
    m.settings.setSetting('rampe_beginn', '2026-09-01');
    expect(m.send.effektivesGlobalLimit(new Date('2026-09-01T09:00:00Z'))).toBe(2);
    expect(m.send.effektivesGlobalLimit(new Date('2026-09-03T09:00:00Z'))).toBe(4);
    expect(m.send.effektivesGlobalLimit(new Date('2027-01-01T09:00:00Z'))).toBe(30);
    m.settings.setSetting('rampe_aktiv', '0');
    expect(m.send.effektivesGlobalLimit(new Date('2026-09-01T09:00:00Z'))).toBe(30);
  });

  it('Beginn ohne Einstellung = Tag der ersten gesendeten Mail, sonst heute', () => {
    const { getDb, schema } = m.db;
    m.settings.setSetting('rampe_aktiv', '1');
    m.settings.setSetting('rampe_start', '10');
    m.settings.setSetting('rampe_schritt', '5');
    // Es gibt (durch vorherige Tests) bereits Versandprotokoll; Tabelle leeren, um den Fall „noch nichts gesendet“ zu prüfen
    getDb().delete(schema.sentMessages).run();
    expect(m.send.effektivesGlobalLimit(new Date('2026-10-05T09:00:00Z'))).toBe(10);
    const k = neueKampagne();
    const l = neuerLead(k.id);
    getDb().insert(schema.sentMessages).values({ leadId: l.id, campaignId: k.id, step: 0, sentAt: new Date('2026-10-01T09:00:00Z') }).run();
    expect(m.send.effektivesGlobalLimit(new Date('2026-10-03T09:00:00Z'))).toBe(20);
  });

  it('die Schleife nutzt das Rampenlimit', async () => {
    m.settings.setSetting('rampe_aktiv', '1');
    m.settings.setSetting('rampe_start', '1');
    m.settings.setSetting('rampe_schritt', '0');
    m.settings.setSetting('rampe_beginn', '2026-07-01');
    const k = neueKampagne();
    neuerLead(k.id);
    neuerLead(k.id);
    const now = tag(30);
    const r1 = await m.loop.runSendTick({ sender, now, zufall });
    expect(r1.sent).toBe(1);
    const r2 = await m.loop.runSendTick({ sender: nichtSenden, now: new Date(now.getTime() + 600_000), zufall });
    expect(r2.sent).toBe(0);
    expect(r2.waiting.some((w) => w.endsWith('limit_global'))).toBe(true);
  });
});

describe('Domain-Sperrliste', () => {
  it('isSuppressed prüft Adresse und Domain', () => {
    m.sup.addSuppression('@Gesperrt-Firma.de', 'manuell');
    expect(m.sup.isSuppressed('max@gesperrt-firma.de')).toBe(true);
    expect(m.sup.isSuppressed('MAX@Gesperrt-Firma.DE')).toBe(true);
    expect(m.sup.isSuppressed('max@sub.gesperrt-firma.de')).toBe(false);
    expect(m.sup.isSuppressed('max@andere-firma.de')).toBe(false);
    m.sup.addSuppression('einzeln@frei-firma.de', 'manuell');
    expect(m.sup.isSuppressed('einzeln@frei-firma.de')).toBe(true);
    expect(m.sup.isSuppressed('anderer@frei-firma.de')).toBe(false);
    m.sup.removeSuppression('@gesperrt-firma.de');
    expect(m.sup.isSuppressed('max@gesperrt-firma.de')).toBe(false);
  });

  it('addSuppression einer Domain überspringt ausstehende Leads der Domain, nicht gesendete', () => {
    const k = neueKampagne();
    const a = neuerLead(k.id, 'a@sperrdomain.de');
    const b = neuerLead(k.id, 'b@SperrDomain.de', { sendStatus: 'nicht_gesendet' });
    const c = neuerLead(k.id, 'c@sperrdomain.de.evil.de');
    const d = neuerLead(k.id, 'd@sperrdomain.de', { sendStatus: 'gesendet' });
    m.sup.addSuppression('@sperrdomain.de', 'manuell');
    expect(leadStatus(a.id)?.sendStatus).toBe('uebersprungen');
    expect(leadStatus(b.id)?.sendStatus).toBe('uebersprungen');
    expect(leadStatus(c.id)?.sendStatus).toBe('geplant');
    expect(leadStatus(d.id)?.sendStatus).toBe('gesendet');
  });

  it('die Versandschleife überspringt Leads gesperrter Domains', async () => {
    const k = neueKampagne();
    const gesperrt = neuerLead(k.id, 'x@loop-sperre.de');
    const frei = neuerLead(k.id, 'y@loop-frei.de');
    m.db.getDb().insert(m.db.schema.suppressionList).values({ email: '@loop-sperre.de', reason: 'test' }).run();
    const r = await m.loop.runSendTick({ sender, now: T0, zufall });
    expect(r.sent).toBe(1);
    expect(leadStatus(gesperrt.id)?.sendStatus).toBe('uebersprungen');
    expect(leadStatus(frei.id)?.sendStatus).toBe('gesendet');
  });

  it('sendLead verweigert gesperrte Domains', async () => {
    const k = neueKampagne();
    const l = neuerLead(k.id, 'z@direkt-sperre.de');
    m.db.getDb().insert(m.db.schema.suppressionList).values({ email: '@direkt-sperre.de', reason: 'test' }).onConflictDoNothing().run();
    const r = await m.send.sendLead(l.id, { sender: nichtSenden, now: T0 });
    expect(r).toMatchObject({ ok: false, kind: 'uebersprungen' });
  });
});

describe('Import-Prüfung mit Domain-Sperre und MX', () => {
  const mapping = { name: null, vorname: null, nachname: null, anrede: null, firma: 'Firma', email: 'Mail', position: null, website: null };
  const rows = [
    { Firma: 'Alt GmbH', Mail: 'a@mx-ok.de' },
    { Firma: 'Tot GmbH', Mail: 'b@mx-tot.de' },
    { Firma: 'Sperr GmbH', Mail: 'c@import-sperre.de' },
    { Firma: 'Unklar GmbH', Mail: 'd@mx-unklar.de' },
  ];
  const resolver = async (domain: string) => {
    if (domain === 'mx-ok.de' || domain === 'import-sperre.de') return [{ exchange: 'mx', priority: 1 }];
    if (domain === 'mx-unklar.de') throw Object.assign(new Error('t'), { code: 'ETIMEOUT' });
    throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' });
  };

  it('Domain-Sperre = gesperrt; Domain ohne MX = kein_mx; unbekannt bleibt gültig', async () => {
    const k = neueKampagne();
    m.db.getDb().insert(m.db.schema.suppressionList).values({ email: '@import-sperre.de', reason: 'test' }).onConflictDoNothing().run();
    const { leereMxCache } = await import('./mx');
    leereMxCache();
    // Resolver für A/AAAA kann nicht injiziert werden → Domain ohne MX muss ohne echtes DNS ENOTFOUND liefern
    const body = { mapping, rows, einProFirma: false, mxTrotzdem: false };
    const { pruefeDomains } = await import('./mx');
    const ohneNetz = async () => {
      throw Object.assign(new Error('nf'), { code: 'ENOTFOUND' });
    };
    const mx = await pruefeDomains(['mx-ok.de', 'mx-tot.de', 'mx-unklar.de'], resolver, 100, ohneNetz, ohneNetz);
    expect(mx.get('mx-tot.de')).toBe('kein_mx');
    expect(mx.get('mx-unklar.de')).toBe('unbekannt');

    const { validateRows } = await import('./import');
    const kontext = { ...m.campaigns.ladeImportKontext(k.id), mx };
    const status = validateRows(body.rows, body.mapping, kontext).map((r) => r.status);
    expect(status).toEqual(['ok', 'kein_mx', 'gesperrt', 'ok']);
    const trotzdem = validateRows(body.rows, body.mapping, { ...kontext, mxTrotzdem: true });
    expect(trotzdem.map((r) => r.status)).toEqual(['ok', 'ok', 'gesperrt', 'ok']);
    expect(trotzdem[1].warnung).toBe('Domain nimmt keine Mails an');
  });

  it('validiereImport fragt nur Domains gültiger Zeilen ab (injizierter Resolver, kein echtes DNS)', async () => {
    const k = neueKampagne();
    m.db.getDb().insert(m.db.schema.suppressionList).values({ email: '@import-sperre.de', reason: 'test' }).onConflictDoNothing().run();
    const { leereMxCache } = await import('./mx');
    leereMxCache();
    const abgefragt: string[] = [];
    const r = async (domain: string) => {
      abgefragt.push(domain);
      if (domain === 'mx-unklar.de') throw Object.assign(new Error('t'), { code: 'ETIMEOUT' });
      return [{ exchange: 'mx', priority: 1 }];
    };
    const ergebnis = await m.importServer.validiereImport(k.id, { mapping, rows: [rows[0], rows[2], rows[3]], einProFirma: false, mxTrotzdem: false }, r);
    expect(ergebnis.map((x) => x.status)).toEqual(['ok', 'gesperrt', 'ok']);
    expect(abgefragt.sort()).toEqual(['mx-ok.de', 'mx-unklar.de']);
  });
});

describe('Kampagne duplizieren', () => {
  it('kopiert Vorlage, Einstellungen, Follow-ups und Varianten, aber keine Leads', () => {
    const { getDb, schema } = m.db;
    const k = neueKampagne({ name: 'Original', sendDays: '1,3,6', startDatum: '2026-09-01', maxNeueLeadsProTag: 7, dailySendLimit: 12, mitVideo: false, trackingPixel: true, status: 'versendet_laufend' });
    getDb().insert(schema.followups).values([
      { campaignId: k.id, position: 1, waitDays: 2, body: 'FU1' },
      { campaignId: k.id, position: 2, waitDays: 5, body: 'FU2' },
    ]).run();
    getDb().insert(schema.varianten).values([
      { campaignId: k.id, kuerzel: 'B', betreff: 'Betreff B', text: 'Text B', aktiv: true },
      { campaignId: k.id, kuerzel: 'C', betreff: 'Betreff C', text: 'Text C', aktiv: false },
    ]).run();
    neuerLead(k.id);

    const kopie = m.campaigns.dupliziereKampagne(k.id);
    expect(kopie).not.toBeNull();
    expect(kopie?.id).not.toBe(k.id);
    expect(kopie).toMatchObject({
      name: 'Original (Kopie)',
      status: 'entwurf',
      sendDays: '1,3,6',
      startDatum: '2026-09-01',
      maxNeueLeadsProTag: 7,
      dailySendLimit: 12,
      mitVideo: false,
      trackingPixel: true,
      emailSubjectTemplate: k.emailSubjectTemplate,
      emailBodyTemplate: k.emailBodyTemplate,
      ctaUrl: k.ctaUrl,
    });
    const id = kopie!.id;
    const fu = getDb().select().from(schema.followups).where(eq(schema.followups.campaignId, id)).orderBy(schema.followups.position).all();
    expect(fu.map((f) => [f.position, f.waitDays, f.body])).toEqual([[1, 2, 'FU1'], [2, 5, 'FU2']]);
    const va = getDb().select().from(schema.varianten).where(eq(schema.varianten.campaignId, id)).orderBy(schema.varianten.kuerzel).all();
    expect(va.map((v) => [v.kuerzel, v.betreff, v.aktiv])).toEqual([['B', 'Betreff B', true], ['C', 'Betreff C', false]]);
    expect(getDb().select().from(schema.leads).where(eq(schema.leads.campaignId, id)).all()).toHaveLength(0);
    // Original unverändert
    expect(getDb().select().from(schema.followups).where(eq(schema.followups.campaignId, k.id)).all()).toHaveLength(2);
    expect(getDb().select().from(schema.campaigns).where(eq(schema.campaigns.id, k.id)).get()?.status).toBe('versendet_laufend');
  });

  it('unbekannte Kampagne = null', () => {
    expect(m.campaigns.dupliziereKampagne(999999)).toBeNull();
  });
});
