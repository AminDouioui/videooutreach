import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { legePostfachAn, setzePostfaecherZurueck } from './test-postfach';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-fuv-'));
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
  send: typeof import('./send');
  campaigns: typeof import('./campaigns');
  mail: typeof import('./mail');
  analyse: typeof import('./analyse');
  fv: typeof import('./followup-varianten');
  fvdb: typeof import('./followup-varianten-db');
};
let m: Mods;
let nr = 0;
const T0 = new Date('2026-07-15T09:00:00Z');
const tag = (n: number) => new Date(T0.getTime() + n * 24 * 3600_000);

function fakeSender() {
  const gesendet: { raw: string; threadId?: string }[] = [];
  const sender = async (raw: string, threadId?: string) => {
    gesendet.push({ raw: Buffer.from(raw, 'base64url').toString('utf8'), threadId });
    return { id: `m${gesendet.length}`, threadId: threadId ?? `neu${gesendet.length}` };
  };
  return { gesendet, sender };
}
function neueKampagne() {
  const { getDb, schema } = m.db;
  return getDb()
    .insert(schema.campaigns)
    .values({ name: 'FV', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}', status: 'versendet_laufend', dailySendLimit: 50 })
    .returning()
    .get();
}
function gesendeterLead(campaignId: number, extra: Partial<typeof import('@/db/schema').leads.$inferInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  return getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `f${nr}@kunde.de`, slug: `fv-${nr}`, renderStatus: 'fertig', sendStatus: 'gesendet', sentAt: T0, gmailThreadId: `erst${nr}`, gmailMessageId: `e${nr}`, rfcMessageId: `<erst${nr}@prozessia.de>`, variante: 'A', ...extra })
    .returning()
    .get();
}
const lead = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;
const gesendet = (id: number) => m.db.getDb().select().from(m.db.schema.sentMessages).where(eq(m.db.schema.sentMessages.leadId, id)).orderBy(m.db.schema.sentMessages.id).all();

beforeAll(async () => {
  m = {
    db: await import('./db'),
    send: await import('./send'),
    campaigns: await import('./campaigns'),
    mail: await import('./mail'),
    analyse: await import('./analyse'),
    fv: await import('./followup-varianten'),
    fvdb: await import('./followup-varianten-db'),
  };
  m.db.getDb();
  await legePostfachAn();
});
beforeEach(async () => {
  m.db.getDb().update(m.db.schema.campaigns).set({ status: 'pausiert' }).run();
  await setzePostfaecherZurueck();
});

describe('Variantenauswahl je Follow-up-Schritt', () => {
  it('rotiert gleichmäßig unter den aktiven Varianten, gespeichert in sent_messages.variante', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [
      { waitDays: 1, body: 'Text A', varianten: [{ kuerzel: 'B', text: 'Text B' }, { kuerzel: 'C', text: 'Text C', aktiv: false }] },
    ]);
    const { gesendet: out, sender } = fakeSender();
    const leads = [gesendeterLead(k.id), gesendeterLead(k.id), gesendeterLead(k.id), gesendeterLead(k.id)];
    for (const l of leads) {
      const r = await m.send.sendFollowup(l.id, { sender, pruefer: async () => null, now: tag(1) });
      expect(r.ok).toBe(true);
    }
    const kuerzel = leads.map((l) => gesendet(l.id).find((x) => x.step === 1)!.variante);
    expect(kuerzel).toEqual(['A', 'B', 'A', 'B']); // C ist inaktiv
    expect(out[0].raw).not.toContain('Text B');
    expect(m.fvdb.followupVariantenZaehler(k.id, 1)).toEqual({ A: 2, B: 2 });
  });

  it('zählt Altbestand ohne Kürzel als A und gleicht Rückstand aus', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 1, body: 'A', varianten: [{ kuerzel: 'B', text: 'B' }] }]);
    const alt = gesendeterLead(k.id);
    m.db.getDb().insert(m.db.schema.sentMessages).values({ leadId: alt.id, campaignId: k.id, step: 1, sentAt: T0 }).run(); // variante = null
    const f = m.send.ladeFollowups(k.id)[0];
    expect(m.fvdb.waehleFollowupVariante(f, 1).kuerzel).toBe('B');
  });

  it('Variante A ist immer dabei; deaktivierte Varianten werden nie gewählt', () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 1, body: 'A', varianten: [{ kuerzel: 'B', text: 'B', aktiv: false }] }]);
    const f = m.send.ladeFollowups(k.id)[0];
    for (let i = 0; i < 3; i++) expect(m.fvdb.waehleFollowupVariante(f, 1).kuerzel).toBe('A');
  });
});

describe('Neuer Thread bei eigenem Betreff', () => {
  const kopf = (raw: string) => raw.split('\r\n\r\n')[0];

  it('ohne Betreff: Re: im selben Thread mit In-Reply-To/References', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 1, body: 'Nachfassen' }]);
    const l = gesendeterLead(k.id);
    const { gesendet: out, sender } = fakeSender();
    await m.send.sendFollowup(l.id, { sender, pruefer: async () => null, now: tag(1) });
    expect(out[0].threadId).toBe(l.gmailThreadId);
    expect(kopf(out[0].raw)).toContain(`In-Reply-To: ${l.rfcMessageId}`);
    expect(kopf(out[0].raw)).toContain(`References: ${l.rfcMessageId}`);
    expect(kopf(out[0].raw)).toMatch(/Subject: Re: Hallo Firma/);
  });

  it('mit Betreff: neuer Thread ohne In-Reply-To/References, Thread-ID in sent_messages, Lead-Thread bleibt', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 1, body: 'Nachfassen', betreff: 'Noch eine Idee für {{firma}}' }]);
    const l = gesendeterLead(k.id);
    const { gesendet: out, sender } = fakeSender();
    const r = await m.send.sendFollowup(l.id, { sender, pruefer: async () => null, now: tag(1) });
    expect(r.ok).toBe(true);
    expect(out[0].threadId).toBeUndefined();
    const h = kopf(out[0].raw);
    expect(h).not.toContain('In-Reply-To');
    expect(h).not.toContain('References');
    const kodiert = h.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)![1];
    expect(Buffer.from(kodiert, 'base64').toString('utf8')).toBe(`Noch eine Idee für ${l.firma}`);
    expect(h).not.toContain('Subject: Re:');
    expect(lead(l.id).gmailThreadId).toBe(l.gmailThreadId);
    const zeile = gesendet(l.id).find((x) => x.step === 1)!;
    expect(zeile.gmailThreadId).toBe('neu1');
  });

  it('eine Variante kann Betreff haben, A nicht (und umgekehrt)', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 1, body: 'A', varianten: [{ kuerzel: 'B', text: 'B', betreff: 'Eigener Betreff' }] }]);
    const { gesendet: out, sender } = fakeSender();
    const a = gesendeterLead(k.id);
    const b = gesendeterLead(k.id);
    await m.send.sendFollowup(a.id, { sender, pruefer: async () => null, now: tag(1) });
    await m.send.sendFollowup(b.id, { sender, pruefer: async () => null, now: tag(1) });
    expect(out[0].threadId).toBe(a.gmailThreadId); // A: Re: im Thread
    expect(out[1].threadId).toBeUndefined(); // B: neuer Thread
    expect(kopf(out[1].raw)).toContain('Subject: Eigener Betreff');
  });

  it('buildEmail/istNeuerThread: leerer oder nur aus Leerzeichen bestehender Betreff gilt als „kein Betreff“', () => {
    expect(m.mail.istNeuerThread({ betreff: '  ' })).toBe(false);
    expect(m.mail.istNeuerThread({ betreff: null })).toBe(false);
    expect(m.mail.istNeuerThread(undefined)).toBe(false);
    expect(m.mail.istNeuerThread({ betreff: ' Hallo ' })).toBe(true);
    expect(m.mail.eigenerBetreff({ betreff: ' Hallo ' })).toBe('Hallo');
  });

  it('Betreff ohne Zeilenumbrüche (Header-Injection)', () => {
    const mail = m.mail.buildEmail(
      { slug: 's', firma: 'X' },
      { emailSubjectTemplate: 'E', emailBodyTemplate: 'B', trackingPixel: false },
      { appUrl: 'https://a.de', signature: '' },
      { body: 'F', betreff: 'Zeile1\r\nBcc: evil@x.de', nr: 1 },
    );
    expect(mail.subject).toBe('Zeile1 Bcc: evil@x.de');
  });
});

describe('Antwort- und Bounce-Erkennung über mehrere Threads', () => {
  it('alleThreadIds: Erstmail zuerst, ohne Doppelte und Leere', () => {
    expect(m.fv.alleThreadIds('t1', ['t1', null, 't2', 't2', undefined, 't3'])).toEqual(['t1', 't2', 't3']);
    expect(m.fv.alleThreadIds(null, [])).toEqual([]);
  });

  it('staerkeresErgebnis: Antwort vor Bounce vor Abwesenheit vor nichts', () => {
    const s = m.fv.staerkeresErgebnis;
    expect(s(null, 'abwesenheit')).toBe('abwesenheit');
    expect(s('abwesenheit', 'bounce')).toBe('bounce');
    expect(s('bounce', 'antwort')).toBe('antwort');
    expect(s('antwort', 'bounce')).toBe('antwort');
    expect(s(null, null)).toBeNull();
  });

  it('prüft alle Threads des Leads; Antwort im Follow-up-Thread beendet den Flow und merkt den Thread', async () => {
    const k = neueKampagne();
    const l = gesendeterLead(k.id);
    m.db.getDb().insert(m.db.schema.sentMessages).values({ leadId: l.id, campaignId: k.id, step: 0, gmailThreadId: l.gmailThreadId, sentAt: T0 }).run();
    m.db.getDb().insert(m.db.schema.sentMessages).values({ leadId: l.id, campaignId: k.id, step: 1, variante: 'B', gmailThreadId: 'folge-thread', sentAt: tag(1) }).run();
    const geprueft: string[] = [];
    const pruefer = async (t: string) => {
      geprueft.push(t);
      return t === 'folge-thread' ? ('antwort' as const) : null;
    };
    expect(await m.send.pruefeAntwort(lead(l.id), pruefer, tag(2))).toBe(true);
    expect(geprueft).toEqual([l.gmailThreadId, 'folge-thread']);
    const nach = lead(l.id);
    expect(nach.flowStopp).toBe('beantwortet');
    expect(nach.antwortThreadId).toBe('folge-thread');
    expect(nach.gmailThreadId).toBe(l.gmailThreadId);
  });

  it('Antwort im Erstmail-Thread lässt antwortThreadId leer; Bounce im Folge-Thread stoppt den Flow', async () => {
    const k = neueKampagne();
    const a = gesendeterLead(k.id);
    m.db.getDb().insert(m.db.schema.sentMessages).values({ leadId: a.id, campaignId: k.id, step: 1, gmailThreadId: 'x-thread', sentAt: tag(1) }).run();
    expect(await m.send.pruefeAntwort(lead(a.id), async (t) => (t === a.gmailThreadId ? 'antwort' : null), tag(2))).toBe(true);
    expect(lead(a.id).antwortThreadId).toBeNull();

    const b = gesendeterLead(k.id);
    m.db.getDb().insert(m.db.schema.sentMessages).values({ leadId: b.id, campaignId: k.id, step: 1, gmailThreadId: 'y-thread', sentAt: tag(1) }).run();
    expect(await m.send.pruefeAntwort(lead(b.id), async (t) => (t === 'y-thread' ? 'bounce' : null), tag(2))).toBe(true);
    expect(lead(b.id).flowStopp).toBe('bounce');
  });

  it('Abwesenheit in einem Thread hindert eine Antwort im anderen nicht', async () => {
    const k = neueKampagne();
    const l = gesendeterLead(k.id);
    m.db.getDb().insert(m.db.schema.sentMessages).values({ leadId: l.id, campaignId: k.id, step: 1, gmailThreadId: 'z-thread', sentAt: tag(1) }).run();
    expect(await m.send.pruefeAntwort(lead(l.id), async (t) => (t === l.gmailThreadId ? 'abwesenheit' : 'antwort'), tag(2))).toBe(true);
    expect(lead(l.id).flowStopp).toBe('beantwortet');
  });

  it('sendFollowup bricht nach einer Antwort im eigenen Follow-up-Thread ab (kein weiteres Follow-up)', async () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [
      { waitDays: 1, body: 'F1', betreff: 'Neuer Thread' },
      { waitDays: 1, body: 'F2' },
    ]);
    const l = gesendeterLead(k.id);
    const { gesendet: out, sender } = fakeSender();
    const beantwortet = new Set<string>();
    const pruefer = async (t: string) => (beantwortet.has(t) ? ('antwort' as const) : null);
    expect((await m.send.sendFollowup(l.id, { sender, pruefer, now: tag(1) })).ok).toBe(true);
    beantwortet.add('neu1'); // Antwort im neuen Thread
    const r = await m.send.sendFollowup(l.id, { sender, pruefer, now: tag(3) });
    expect(r.ok).toBe(false);
    expect(out).toHaveLength(1);
    expect(lead(l.id).flowStopp).toBe('beantwortet');
  });
});

describe('Statistik je Schritt und Variante', () => {
  const lead = (id: number, extra: Partial<import('./analyse').AnalyseLead> = {}): import('./analyse').AnalyseLead => ({
    id, mitVideo: false, sendStatus: 'gesendet', flowStopp: null, unsubscribed: false, leadStatus: 'offen', antwortAt: null, flowStoppAt: null, ...extra,
  });

  it('zählt gesendet und Antworten danach je Variante; Antwort zählt der zuletzt davor gesendeten Mail', () => {
    const versand = [
      { leadId: 1, step: 0, sentAt: 100, variante: 'A' },
      { leadId: 1, step: 1, sentAt: 200, variante: 'A' },
      { leadId: 2, step: 0, sentAt: 100, variante: 'A' },
      { leadId: 2, step: 1, sentAt: 200, variante: 'B' },
      { leadId: 3, step: 0, sentAt: 100, variante: 'A' },
      { leadId: 3, step: 1, sentAt: 200, variante: null }, // Altbestand = A
      { leadId: 4, step: 0, sentAt: 100, variante: 'A' },
      { leadId: 4, step: 1, sentAt: 200, variante: 'B' },
    ];
    const leads = [
      lead(1),
      lead(2, { antwortAt: 300 }), // nach Follow-up 1 (B)
      lead(3, { antwortAt: 150 }), // vor dem Follow-up -> Erstmail
      lead(4, { antwortAt: 300 }), // B
    ];
    const z = m.analyse.aggregiereSchritte(leads, versand, 3, { 1: ['B', 'C'] });
    const f1 = z[1];
    expect(f1.gesendet).toBe(4);
    expect(f1.antworten).toBe(2);
    expect(f1.varianten).toEqual([
      { kuerzel: 'A', gesendet: 2, antworten: 0, antwortRate: 0 },
      { kuerzel: 'B', gesendet: 2, antworten: 2, antwortRate: 1 },
      { kuerzel: 'C', gesendet: 0, antworten: 0, antwortRate: 0 },
    ]);
    // Schritt 2 ist konfiguriert, aber ohne Versand: nur Zeile A mit 0
    expect(z[2].varianten).toEqual([{ kuerzel: 'A', gesendet: 0, antworten: 0, antwortRate: 0 }]);
    expect(z[0].varianten).toEqual([{ kuerzel: 'A', gesendet: 4, antworten: 1, antwortRate: 0.25 }]);
  });

  it('ladeKampagnenAnalyse liest Varianten aus der DB', () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 1, body: 'A', varianten: [{ kuerzel: 'B', text: 'B' }] }]);
    const l = gesendeterLead(k.id);
    const { getDb, schema } = m.db;
    getDb().insert(schema.sentMessages).values({ leadId: l.id, campaignId: k.id, step: 0, variante: 'A', sentAt: T0 }).run();
    getDb().insert(schema.sentMessages).values({ leadId: l.id, campaignId: k.id, step: 1, variante: 'B', sentAt: tag(1) }).run();
    const a = m.analyse.ladeKampagnenAnalyse(k.id, 2);
    expect(a.schritte[1].varianten.map((v) => [v.kuerzel, v.gesendet])).toEqual([['A', 0], ['B', 1]]);
  });
});

describe('Speichern und Duplizieren', () => {
  it('Varianten und Betreff bleiben beim Speichern, Neuspeichern und Duplizieren erhalten', () => {
    const k = neueKampagne();
    m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'A', betreff: ' Betreff ', varianten: [{ kuerzel: 'B', text: 'B', betreff: '', aktiv: false }] }]);
    const f = m.send.ladeFollowups(k.id)[0];
    expect(f.betreff).toBe('Betreff');
    const v = m.fvdb.ladeFollowupVarianten(f.id);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kuerzel: 'B', betreff: null, aktiv: false });
    const kopie = m.campaigns.dupliziereKampagne(k.id)!;
    const fk = m.send.ladeFollowups(kopie.id)[0];
    expect(fk.betreff).toBe('Betreff');
    expect(m.fvdb.ladeFollowupVarianten(fk.id).map((x) => x.kuerzel)).toEqual(['B']);
    // Schritt löschen entfernt Varianten (Cascade)
    m.campaigns.speichereFollowups(k.id, []);
    expect(m.db.getDb().select().from(m.db.schema.followupVarianten).where(eq(m.db.schema.followupVarianten.followupId, f.id)).all()).toHaveLength(0);
  });
});
