import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { legePostfachAn, setzePostfaecherZurueck } from './test-postfach';

// Eigene Test-DB, bevor lib/db das erste Mal geöffnet wird
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-anhang-'));
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
  ah: typeof import('./anhaenge-db');
  loop: typeof import('./send-loop');
  campaigns: typeof import('./campaigns');
  roh: typeof import('./mime-roh');
  limits: typeof import('./anhaenge');
};
let m: Mods;
let nr = 0;

const T0 = new Date('2026-07-15T09:00:00Z'); // Mittwoch 11:00 Berlin
const tag = (n: number) => new Date(T0.getTime() + n * 24 * 3600_000);
const zufall = () => 0;

const pdf = (inhalt = 'x') => Buffer.from(`%PDF-1.4\n${inhalt}\n%%EOF`);

function fakeSender() {
  const gesendet: { raw: string; threadId?: string }[] = [];
  const sender = async (raw: string, threadId?: string) => {
    gesendet.push({ raw: Buffer.from(raw, 'base64url').toString('utf8'), threadId });
    return { id: `m${gesendet.length}`, threadId: threadId ?? `t${gesendet.length}` };
  };
  return { gesendet, sender };
}

function neueKampagne() {
  const { getDb, schema } = m.db;
  return getDb()
    .insert(schema.campaigns)
    .values({ name: 'Anhang', ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}\n\n{{vorschaubild}}', status: 'versendet_laufend', dailySendLimit: 50 })
    .returning()
    .get();
}
function neuerLead(campaignId: number) {
  const { getDb, schema } = m.db;
  nr++;
  return getDb().insert(schema.leads).values({ campaignId, firma: `Firma ${nr}`, email: `a${nr}@kunde.de`, slug: `anh-${nr}`, renderStatus: 'fertig', sendStatus: 'geplant' }).returning().get();
}
const dateien = (campaignId: number) => {
  const d = path.join(dir, 'anhaenge', String(campaignId));
  return fs.existsSync(d) ? fs.readdirSync(d) : [];
};
/** Namen der Anhang-Teile (filename) einer Rohnachricht; leer = kein Anhang */
const anhangNamen = (raw: string) => {
  const baum = m.roh.parseRohnachricht(Buffer.from(raw));
  return baum.mimeType === 'multipart/mixed' ? (baum.parts ?? []).map((p) => p.filename).filter((x): x is string => !!x) : [];
};

beforeAll(async () => {
  m = {
    db: await import('./db'),
    ah: await import('./anhaenge-db'),
    loop: await import('./send-loop'),
    campaigns: await import('./campaigns'),
    roh: await import('./mime-roh'),
    limits: await import('./anhaenge'),
  };
  m.db.getDb();
  await legePostfachAn();
});

beforeEach(async () => {
  m.db.getDb().update(m.db.schema.campaigns).set({ status: 'pausiert' }).run();
  await setzePostfaecherZurueck();
});

describe('Anhänge speichern, begrenzen, löschen', () => {
  it('speichert Datei und Datensatz; Pfad relativ zu DATA_DIR und unter anhaenge/<Kampagne>/', () => {
    const k = neueKampagne();
    const r = m.ah.speichereAnhang(k.id, null, '../../Übersicht Größe.pdf', pdf());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.anhang).toMatchObject({ campaignId: k.id, followupId: null, dateiname: 'Übersicht Größe.pdf', mime: 'application/pdf', groesse: pdf().length });
    expect(r.anhang.pfad).toMatch(new RegExp(`^anhaenge/${k.id}/[0-9a-f]{16}-Ubersicht_Grosse\\.pdf$`));
    expect(fs.readFileSync(path.join(dir, r.anhang.pfad)).equals(pdf())).toBe(true);
    expect(m.ah.ladeAnhaenge(k.id, null)).toHaveLength(1);
    expect(m.ah.ladeAnhaenge(k.id, 999)).toHaveLength(0);
  });

  it('lehnt ungültige Typen und Inhalte ab, ohne Datei oder Datensatz anzulegen', () => {
    const k = neueKampagne();
    expect(m.ah.speichereAnhang(k.id, null, 'virus.exe', Buffer.from('MZ'))).toMatchObject({ ok: false, status: 400 });
    expect(m.ah.speichereAnhang(k.id, null, 'getarnt.pdf', Buffer.from('MZ-programm'))).toMatchObject({ ok: false });
    expect(m.ah.ladeAnhaenge(k.id, null)).toHaveLength(0);
    expect(dateien(k.id)).toHaveLength(0);
  });

  it('höchstens 5 Dateien je Schritt, aber je Schritt unabhängig', () => {
    const k = neueKampagne();
    const [f] = m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'x' }]).map((id) => id);
    for (let i = 0; i < m.limits.MAX_ANZAHL; i++) expect(m.ah.speichereAnhang(k.id, null, `a${i}.pdf`, pdf(String(i))).ok).toBe(true);
    const sechs = m.ah.speichereAnhang(k.id, null, 'a6.pdf', pdf('6'));
    expect(sechs).toMatchObject({ ok: false });
    expect(!sechs.ok && sechs.fehler).toContain('Höchstens 5');
    expect(m.ah.speichereAnhang(k.id, f, 'follow.pdf', pdf()).ok).toBe(true);
  });

  it('höchstens 15 MB je Mail insgesamt', () => {
    const k = neueKampagne();
    const gross = (n: number) => Buffer.concat([pdf(), Buffer.alloc(n * 1024 * 1024)]);
    expect(m.ah.speichereAnhang(k.id, null, 'a.pdf', gross(8)).ok).toBe(true);
    const zweite = m.ah.speichereAnhang(k.id, null, 'b.pdf', gross(8));
    expect(zweite).toMatchObject({ ok: false });
    expect(!zweite.ok && zweite.fehler).toContain('zusammen');
    expect(m.ah.speichereAnhang(k.id, null, 'c.pdf', gross(6)).ok).toBe(true);
  });

  it('Follow-up muss zur Kampagne gehören', () => {
    const a = neueKampagne();
    const b = neueKampagne();
    const [fb] = m.campaigns.speichereFollowups(b.id, [{ waitDays: 2, body: 'x' }]);
    expect(m.ah.speichereAnhang(a.id, fb, 'a.pdf', pdf())).toMatchObject({ ok: false, status: 404 });
  });

  it('Anhang löschen entfernt Datensatz und Datei', () => {
    const k = neueKampagne();
    const r = m.ah.speichereAnhang(k.id, null, 'a.pdf', pdf());
    if (!r.ok) throw new Error('Upload');
    expect(dateien(k.id)).toHaveLength(1);
    expect(m.ah.loescheAnhang(r.anhang.id)).toBe(true);
    expect(m.ah.ladeAnhang(r.anhang.id)).toBeUndefined();
    expect(dateien(k.id)).toHaveLength(0);
    expect(m.ah.loescheAnhang(r.anhang.id)).toBe(false);
  });

  it('Pfade außerhalb der Anhang-Wurzel werden verweigert', () => {
    expect(() => m.ah.anhangPfad('../app.db')).toThrow();
    expect(() => m.ah.anhangPfad('media/x.mp4')).toThrow();
    expect(() => m.ah.anhangPfad('anhaenge/../../etc/passwd')).toThrow();
  });

  it('Follow-ups speichern behält Anhänge bestehender Schritte; entfernte Schritte nehmen ihre Dateien mit', () => {
    const k = neueKampagne();
    const [f1, f2] = m.campaigns.speichereFollowups(k.id, [
      { waitDays: 2, body: 'eins' },
      { waitDays: 3, body: 'zwei' },
    ]);
    m.ah.speichereAnhang(k.id, f1, 'eins.pdf', pdf('1'));
    m.ah.speichereAnhang(k.id, f2, 'zwei.pdf', pdf('2'));
    expect(dateien(k.id)).toHaveLength(2);

    // Reihenfolge tauschen, Text ändern, Schritt 3 neu – IDs bleiben, Anhänge hängen am Schritt
    const ids = m.campaigns.speichereFollowups(k.id, [
      { id: f2, waitDays: 5, body: 'zwei neu' },
      { id: f1, waitDays: 2, body: 'eins' },
      { waitDays: 1, body: 'drei' },
    ]);
    expect(ids.slice(0, 2)).toEqual([f2, f1]);
    expect(ids[2]).not.toBe(f1);
    expect(m.ah.ladeAnhaenge(k.id, f1).map((a) => a.dateiname)).toEqual(['eins.pdf']);
    expect(m.ah.ladeAnhaenge(k.id, f2).map((a) => a.dateiname)).toEqual(['zwei.pdf']);
    expect(m.ah.ladeAnhaenge(k.id, ids[2])).toHaveLength(0);

    // Schritt 1 (f2) entfernen: Datensatz (Cascade) und Datei sind weg, der andere bleibt
    m.campaigns.speichereFollowups(k.id, [{ id: f1, waitDays: 2, body: 'eins' }]);
    expect(m.ah.ladeAnhaenge(k.id, f2)).toHaveLength(0);
    expect(dateien(k.id)).toHaveLength(1);
    expect(m.ah.ladeAnhaenge(k.id, f1)).toHaveLength(1);
  });

  it('Kampagne löschen entfernt alle Datensätze und das Verzeichnis', () => {
    const k = neueKampagne();
    const [f] = m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'x' }]);
    m.ah.speichereAnhang(k.id, null, 'erst.pdf', pdf());
    m.ah.speichereAnhang(k.id, f, 'folge.pdf', pdf());
    expect(dateien(k.id)).toHaveLength(2);
    m.campaigns.loescheKampagne(k.id);
    expect(m.db.getDb().select().from(m.db.schema.anhaenge).where(eq(m.db.schema.anhaenge.campaignId, k.id)).all()).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'anhaenge', String(k.id)))).toBe(false);
  });

  it('Kampagne duplizieren kopiert Anhänge samt Dateien (Löschen der Kopie berührt das Original nicht)', () => {
    const k = neueKampagne();
    const [f] = m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'x' }]);
    m.ah.speichereAnhang(k.id, null, 'erst.pdf', pdf('a'));
    m.ah.speichereAnhang(k.id, f, 'folge.pdf', pdf('b'));
    const kopie = m.campaigns.dupliziereKampagne(k.id)!;
    const kopieFollowup = m.db.getDb().select().from(m.db.schema.followups).where(eq(m.db.schema.followups.campaignId, kopie.id)).get()!;
    expect(m.ah.ladeAnhaenge(kopie.id, null).map((a) => a.dateiname)).toEqual(['erst.pdf']);
    expect(m.ah.ladeAnhaenge(kopie.id, kopieFollowup.id).map((a) => a.dateiname)).toEqual(['folge.pdf']);
    m.campaigns.loescheKampagne(kopie.id);
    expect(m.ah.ladeAnhangDateien(k.id, null)[0].inhalt.equals(pdf('a'))).toBe(true);
    expect(m.ah.ladeAnhangDateien(k.id, f)[0].inhalt.equals(pdf('b'))).toBe(true);
  });

  it('fehlt die Datei auf der Platte, wird nicht ohne sie gesendet', async () => {
    const k = neueKampagne();
    neuerLead(k.id);
    const r = m.ah.speichereAnhang(k.id, null, 'weg.pdf', pdf());
    if (!r.ok) throw new Error('Upload');
    fs.unlinkSync(path.join(dir, r.anhang.pfad));
    const { gesendet, sender } = fakeSender();
    expect((await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall })).sent).toBe(0);
    expect(gesendet).toHaveLength(0);
    const lead = m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.campaignId, k.id)).get()!;
    expect(lead.sendStatus).toBe('fehler');
    expect(lead.sendError).toContain('weg.pdf');
  });
});

describe('Versand: Anhänge des richtigen Schritts', () => {
  it('Erstmail trägt nur ihre Anhänge, jedes Follow-up nur seine; Threading bleibt', async () => {
    const k = neueKampagne();
    const [f1, f2] = m.campaigns.speichereFollowups(k.id, [
      { waitDays: 2, body: 'Nachfassen eins' },
      { waitDays: 2, body: 'Nachfassen zwei' },
    ]);
    m.ah.speichereAnhang(k.id, null, 'Erstmail Übersicht.pdf', pdf('erst'));
    m.ah.speichereAnhang(k.id, f1, 'folge1.pdf', pdf('f1'));
    m.ah.speichereAnhang(k.id, f1, 'folge1-b.pdf', pdf('f1b'));
    // f2 hat bewusst keinen Anhang
    expect(f2).toBeGreaterThan(f1);
    const l = neuerLead(k.id);
    const { gesendet, sender } = fakeSender();
    const pruefer = async () => null;

    expect((await m.loop.runSendTick({ sender, pruefer, now: T0, zufall })).sent).toBe(1);
    expect((await m.loop.runSendTick({ sender, pruefer, now: tag(2), zufall })).sent).toBe(1);
    expect((await m.loop.runSendTick({ sender, pruefer, now: tag(5), zufall })).sent).toBe(1);
    expect(gesendet).toHaveLength(3);

    expect(anhangNamen(gesendet[0].raw)).toEqual(['Erstmail Übersicht.pdf']);
    expect(anhangNamen(gesendet[1].raw)).toEqual(['folge1.pdf', 'folge1-b.pdf']);
    // Follow-up ohne Anhang: unverändert multipart/alternative
    expect(anhangNamen(gesendet[2].raw)).toEqual([]);
    expect(gesendet[2].raw).toContain('Content-Type: multipart/alternative; boundary=');
    expect(gesendet[2].raw).not.toContain('multipart/mixed');

    // Inhalt der Datei ist byte-genau in der gesendeten Mail
    const erstTeil = m.roh.parseRohnachricht(Buffer.from(gesendet[0].raw)).parts![1];
    expect(erstTeil.mimeType).toBe('application/pdf');
    expect(gesendet[0].raw).toContain(pdf('erst').toString('base64'));

    // Threading der Follow-ups mit Anhang
    const lead = m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, l.id)).get()!;
    expect(gesendet[1].threadId).toBe(lead.gmailThreadId);
    expect(gesendet[1].raw).toContain(`In-Reply-To: ${lead.rfcMessageId}`);
    expect(gesendet[1].raw).toContain(`References: ${lead.rfcMessageId}`);
    expect(gesendet[1].raw).toContain('Subject: Re: Hallo Firma');
  });

  it('Anhang einer anderen Kampagne landet nicht in der Mail; ohne Anhänge bleibt alles wie bisher', async () => {
    const mit = neueKampagne();
    const ohne = neueKampagne();
    m.ah.speichereAnhang(mit.id, null, 'nur-mit.pdf', pdf());
    neuerLead(ohne.id);
    const { gesendet, sender } = fakeSender();
    await m.loop.runSendTick({ sender, pruefer: async () => null, now: T0, zufall });
    expect(gesendet).toHaveLength(1);
    expect(anhangNamen(gesendet[0].raw)).toEqual([]);
    expect(gesendet[0].raw).not.toContain('Content-Disposition');
  });

  it('Testmail (buildLeadMime) enthält die Anhänge der Erstmail bzw. des gewählten Schritts', async () => {
    const { buildLeadMime } = await import('./send');
    const k = neueKampagne();
    const [f] = m.campaigns.speichereFollowups(k.id, [{ waitDays: 2, body: 'folge' }]);
    m.ah.speichereAnhang(k.id, null, 'erst.pdf', pdf());
    m.ah.speichereAnhang(k.id, f, 'folge.pdf', pdf());
    const l = neuerLead(k.id);
    const postfach = m.db.getDb().select().from(m.db.schema.absender).get()!;
    const roh = (opts: Parameters<typeof buildLeadMime>[2]) => Buffer.from(buildLeadMime(l, k, opts), 'base64url').toString('utf8');
    expect(anhangNamen(roh({ absender: postfach, vorschau: true }))).toEqual(['erst.pdf']);
    expect(anhangNamen(roh({ absender: postfach, vorschau: true, schritt: { body: 'folge', nr: 1, followupId: f } }))).toEqual(['folge.pdf']);
    // Schritt ohne Datensatz (reine Vorschau): keine Anhänge
    expect(anhangNamen(roh({ absender: postfach, vorschau: true, schritt: { body: 'folge', nr: 1 } }))).toEqual([]);
  });
});
