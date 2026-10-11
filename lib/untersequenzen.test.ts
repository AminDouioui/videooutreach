import fs from 'fs';
import os from 'os';
import path from 'path';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { pruefeUebernahme } from './untersequenz';
import { legePostfachAn } from './test-postfach';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-untersequenz-'));
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
  status: typeof import('./lead-status-db');
  us: typeof import('./untersequenzen-db');
  ki: typeof import('./ki-einordnung');
  suppression: typeof import('./suppression');
  campaigns: typeof import('./campaigns');
  loop: typeof import('./send-loop');
};
let m: Mods;
let nr = 0;

type KInsert = typeof import('@/db/schema').campaigns.$inferInsert;
type LInsert = typeof import('@/db/schema').leads.$inferInsert;

function kampagne(extra: Partial<KInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  return getDb()
    .insert(schema.campaigns)
    .values({ name: `K${nr}`, ctaUrl: 'https://x.de', emailSubjectTemplate: 'Hallo {{firma}}', emailBodyTemplate: '{{begruessung}}', ...extra })
    .returning()
    .get();
}
function lead(campaignId: number, extra: Partial<LInsert> = {}) {
  const { getDb, schema } = m.db;
  nr++;
  return getDb()
    .insert(schema.leads)
    .values({ campaignId, firma: `Firma ${nr}`, email: `f${nr}@kunde${nr}.de`, slug: `us-${nr}`, ...extra })
    .returning()
    .get();
}
const alle = (campaignId: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.campaignId, campaignId)).all();
const holen = (id: number) => m.db.getDb().select().from(m.db.schema.leads).where(eq(m.db.schema.leads.id, id)).get()!;
const events = (leadId: number) => m.db.getDb().select().from(m.db.schema.events).where(eq(m.db.schema.events.leadId, leadId)).all();

beforeAll(async () => {
  m = {
    db: await import('./db'),
    status: await import('./lead-status-db'),
    us: await import('./untersequenzen-db'),
    ki: await import('./ki-einordnung'),
    suppression: await import('./suppression'),
    campaigns: await import('./campaigns'),
    loop: await import('./send-loop'),
  };
  m.db.getDb();
});

describe('pruefeUebernahme (rein)', () => {
  const ok = { quelleCampaignId: 1, zielCampaignId: 2, abgemeldet: false, gesperrt: false, schonInZiel: false };
  it('übernimmt ohne Ausschlussgrund', () => expect(pruefeUebernahme(ok)).toBeNull());
  it('Ausschlussgründe', () => {
    expect(pruefeUebernahme({ ...ok, zielCampaignId: 1 })).toBe('ziel_gleich_quelle');
    expect(pruefeUebernahme({ ...ok, abgemeldet: true })).toBe('abgemeldet');
    expect(pruefeUebernahme({ ...ok, gesperrt: true })).toBe('gesperrt');
    expect(pruefeUebernahme({ ...ok, schonInZiel: true })).toBe('schon_in_ziel');
  });
});

describe('Regeln verwalten', () => {
  it('legt an, verhindert Doppelte/gleiche Kampagne/Status offen, schaltet und löscht', () => {
    const a = kampagne();
    const b = kampagne();
    expect(m.us.legeRegelAn(a.id, 'offen', b.id)).toEqual({ ok: false, fehler: 'status' });
    expect(m.us.legeRegelAn(a.id, 'quatsch', b.id)).toEqual({ ok: false, fehler: 'status' });
    expect(m.us.legeRegelAn(a.id, 'spaeter', a.id)).toEqual({ ok: false, fehler: 'gleich' });
    expect(m.us.legeRegelAn(a.id, 'spaeter', 99999)).toEqual({ ok: false, fehler: 'ziel' });
    const r = m.us.legeRegelAn(a.id, 'spaeter', b.id);
    expect(r.ok).toBe(true);
    expect(m.us.legeRegelAn(a.id, 'spaeter', b.id)).toEqual({ ok: false, fehler: 'doppelt' });
    const regeln = m.us.ladeRegeln(a.id);
    expect(regeln).toHaveLength(1);
    expect(regeln[0]).toMatchObject({ ausloeserStatus: 'spaeter', zielCampaignId: b.id, zielName: b.name, aktiv: true });
    expect(m.us.setzeRegelAktiv(a.id, regeln[0].id, false)).toBe(true);
    expect(m.us.ladeRegeln(a.id)[0].aktiv).toBe(false);
    // Regel gehört zur Quell-Kampagne
    expect(m.us.setzeRegelAktiv(b.id, regeln[0].id, true)).toBe(false);
    expect(m.us.loescheRegel(b.id, regeln[0].id)).toBe(false);
    expect(m.us.loescheRegel(a.id, regeln[0].id)).toBe(true);
    expect(m.us.ladeRegeln(a.id)).toHaveLength(0);
  });
  it('Regeln verschwinden mit Quell- und Ziel-Kampagne (Cascade)', () => {
    const a = kampagne();
    const b = kampagne();
    m.us.legeRegelAn(a.id, 'spaeter', b.id);
    m.campaigns.loescheKampagne(b.id);
    expect(m.us.ladeRegeln(a.id)).toHaveLength(0);
  });
});

describe('Übernahme beim Statuswechsel', () => {
  it('manueller Statuswechsel kopiert den Lead mit Stammdaten, Postfach, Herkunft und Event', async () => {
    const pf = await legePostfachAn();
    const q = kampagne();
    const z = kampagne({ mitVideo: false });
    m.us.legeRegelAn(q.id, 'spaeter', z.id);
    const l = lead(q.id, { anrede: 'Herr', vorname: 'Max', nachname: 'Muster', position: 'CEO', website: 'https://muster.de', zeitzone: 'America/New_York', extra: { branche: 'Bau' }, absenderId: pf.id, sendStatus: 'gesendet', renderStatus: 'fertig', videoPath: 'x.mp4', dealWert: 5000 });

    expect(m.status.setzeLeadStatus(l.id, 'spaeter')).toBe(true);

    const kopien = alle(z.id);
    expect(kopien).toHaveLength(1);
    const k = kopien[0];
    expect(k).toMatchObject({ firma: l.firma, anrede: 'Herr', vorname: 'Max', nachname: 'Muster', email: l.email, position: 'CEO', website: 'https://muster.de', zeitzone: 'America/New_York', extra: { branche: 'Bau' }, absenderId: pf.id, herkunftLeadId: l.id });
    expect(k.slug).not.toBe(l.slug);
    expect(k.slug).toMatch(/^[a-z0-9-]+-[a-z0-9]{4}$/);
    // Flow startet neu
    expect(k).toMatchObject({ leadStatus: 'offen', sendStatus: 'nicht_gesendet', renderStatus: 'wartet', flowStopp: null, followupsSent: 0, videoPath: null, gmailThreadId: null, dealWert: null });
    // Event im Ursprungs-Lead
    const ev = events(l.id).filter((e) => e.type === 'untersequenz');
    expect(ev).toHaveLength(1);
    expect(ev[0].meta).toMatchObject({ zielCampaignId: z.id, zielLeadId: k.id });
    // Ursprungs-Lead bleibt unverändert (außer Status)
    expect(holen(l.id)).toMatchObject({ campaignId: q.id, leadStatus: 'spaeter' });
  });

  it('löst nur beim passenden Status aus, nicht bei inaktiver Regel, nicht beim erneuten Setzen desselben Status', () => {
    const q = kampagne();
    const z = kampagne();
    const r = m.us.legeRegelAn(q.id, 'interessiert', z.id);
    const l = lead(q.id);
    m.status.setzeLeadStatus(l.id, 'spaeter');
    expect(alle(z.id)).toHaveLength(0);
    if (r.ok) m.us.setzeRegelAktiv(q.id, r.id, false);
    m.status.setzeLeadStatus(l.id, 'interessiert');
    expect(alle(z.id)).toHaveLength(0);
    if (r.ok) m.us.setzeRegelAktiv(q.id, r.id, true);
    m.status.setzeLeadStatus(l.id, 'spaeter');
    m.status.setzeLeadStatus(l.id, 'interessiert');
    expect(alle(z.id)).toHaveLength(1);
  });

  it('kein Doppel: erneuter Statuswechsel erzeugt keine zweite Kopie', () => {
    const q = kampagne();
    const z = kampagne();
    m.us.legeRegelAn(q.id, 'interessiert', z.id);
    const l = lead(q.id);
    m.status.setzeLeadStatus(l.id, 'interessiert');
    m.status.setzeLeadStatus(l.id, 'spaeter');
    m.status.setzeLeadStatus(l.id, 'interessiert');
    expect(alle(z.id)).toHaveLength(1);
    expect(events(l.id).filter((e) => e.type === 'untersequenz')).toHaveLength(1);
  });

  it('Ausschlussgründe: E-Mail gesperrt, Domain gesperrt, abgemeldet, schon in Ziel (auch andere Schreibweise)', () => {
    const q = kampagne();
    const z = kampagne();
    m.us.legeRegelAn(q.id, 'interessiert', z.id);
    const gesperrt = lead(q.id, { email: 'gesperrt@sperre-a.de' });
    const domain = lead(q.id, { email: 'jemand@sperre-b.de' });
    const abgemeldet = lead(q.id, { unsubscribed: true });
    const dopp = lead(q.id, { email: 'dopp@kunde.de' });
    lead(z.id, { email: 'DOPP@kunde.de' });
    m.suppression.addSuppression('gesperrt@sperre-a.de', 'manuell');
    m.suppression.addSuppression('@sperre-b.de', 'manuell');
    for (const l of [gesperrt, domain, abgemeldet, dopp]) m.status.setzeLeadStatus(l.id, 'interessiert');
    expect(alle(z.id).map((x) => x.email)).toEqual(['DOPP@kunde.de']);
    for (const l of [gesperrt, domain, abgemeldet, dopp]) expect(events(l.id).filter((e) => e.type === 'untersequenz')).toHaveLength(0);
    // Status wurde trotzdem gesetzt
    expect(holen(gesperrt.id).leadStatus).toBe('interessiert');
  });

  it('Ziel = Quelle wird nicht übernommen (auch bei Altdaten)', () => {
    const q = kampagne();
    const l = lead(q.id);
    m.db.getDb().insert(m.db.schema.untersequenzen).values({ campaignId: q.id, ausloeserStatus: 'interessiert', zielCampaignId: q.id }).run();
    m.status.setzeLeadStatus(l.id, 'interessiert');
    expect(alle(q.id)).toHaveLength(1);
    const { wendeUntersequenzenAn } = m.us;
    expect(wendeUntersequenzenAn(l.id, 'interessiert')).toEqual([expect.objectContaining({ uebernommen: false, grund: 'ziel_gleich_quelle' })]);
  });

  it('mehrere Regeln für denselben Status: je Ziel eine Kopie', () => {
    const q = kampagne();
    const z1 = kampagne();
    const z2 = kampagne();
    m.us.legeRegelAn(q.id, 'nicht_interessiert', z1.id);
    m.us.legeRegelAn(q.id, 'nicht_interessiert', z2.id);
    const l = lead(q.id);
    m.status.setzeLeadStatus(l.id, 'nicht_interessiert');
    expect(alle(z1.id)).toHaveLength(1);
    expect(alle(z2.id)).toHaveLength(1);
  });

  it('flow-beendender Status stoppt den Ursprungs-Lead, die Kopie läuft frei', () => {
    const q = kampagne();
    const z = kampagne({ mitVideo: false });
    m.us.legeRegelAn(q.id, 'nicht_interessiert', z.id);
    const l = lead(q.id, { sendStatus: 'gesendet', renderStatus: 'fertig' });
    m.status.setzeLeadStatus(l.id, 'nicht_interessiert');
    expect(holen(l.id).flowStopp).toBe('status');
    const k = alle(z.id)[0];
    expect(k.flowStopp).toBeNull();
    expect(k.leadStatus).toBe('offen');
  });

  it('Video-Ziel: nur vorgemerkt, wenn die Kampagne rendert oder versendet; sonst wartet der Lead', () => {
    const q = kampagne();
    const entwurf = kampagne({ status: 'entwurf' });
    const rendert = kampagne({ status: 'rendert' });
    const laeuft = kampagne({ status: 'versendet_laufend' });
    const text = kampagne({ status: 'versendet_laufend', mitVideo: false });
    for (const z of [entwurf, rendert, laeuft, text]) m.us.legeRegelAn(q.id, 'gewonnen', z.id);
    const l = lead(q.id);
    m.status.setzeLeadStatus(l.id, 'gewonnen');
    expect(alle(entwurf.id)[0]).toMatchObject({ renderRequested: false, renderStatus: 'wartet' });
    expect(alle(rendert.id)[0].renderRequested).toBe(true);
    expect(alle(laeuft.id)[0].renderRequested).toBe(true);
    expect(alle(text.id)[0]).toMatchObject({ renderRequested: false, sendStatus: 'nicht_gesendet' });
  });

  it('KI-Einordnung (Vorschlag übernehmen) löst die Übernahme aus', () => {
    const q = kampagne();
    const z = kampagne();
    m.us.legeRegelAn(q.id, 'interessiert', z.id);
    const l = lead(q.id, { flowStopp: 'beantwortet', kiEinordnung: { kategorie: 'interessiert', konfidenz: 0.95, begruendung: 'Will Termin', at: Date.now() } });
    expect(m.ki.uebernimmEinordnung(l.id)).toMatchObject({ ok: true, angewendet: true });
    expect(holen(l.id).leadStatus).toBe('interessiert');
    expect(alle(z.id)).toHaveLength(1);
    expect(alle(z.id)[0].herkunftLeadId).toBe(l.id);
  });

  it('Ursprungs-Lead löschen: Kopie bleibt, Herkunft wird leer', () => {
    const q = kampagne();
    const z = kampagne();
    m.us.legeRegelAn(q.id, 'interessiert', z.id);
    const l = lead(q.id);
    m.status.setzeLeadStatus(l.id, 'interessiert');
    const { getDb, schema } = m.db;
    getDb().delete(schema.events).where(eq(schema.events.leadId, l.id)).run();
    getDb().delete(schema.leads).where(eq(schema.leads.id, l.id)).run();
    expect(alle(z.id)[0].herkunftLeadId).toBeNull();
  });

  it('Kampagne duplizieren übernimmt keine Regeln (Ziel wäre unklar)', () => {
    const q = kampagne();
    const z = kampagne();
    m.us.legeRegelAn(q.id, 'interessiert', z.id);
    const kopie = m.campaigns.dupliziereKampagne(q.id)!;
    expect(m.us.ladeRegeln(kopie.id)).toHaveLength(0);
    expect(m.us.ladeRegeln(q.id)).toHaveLength(1);
  });
});

describe('Versand über das Postfach des Ursprungs-Leads', () => {
  it('übernommener Lead schreibt über dasselbe Postfach, nicht über die Rotation', async () => {
    const pf1 = await legePostfachAn();
    const pf2 = await legePostfachAn();
    // Nur die Ziel-Kampagne dieses Tests soll senden
    m.db.getDb().update(m.db.schema.campaigns).set({ status: 'pausiert' }).run();
    const q = kampagne();
    const z = kampagne({ mitVideo: false, status: 'versendet_laufend', dailySendLimit: 50 });
    m.us.legeRegelAn(q.id, 'interessiert', z.id);
    const l = lead(q.id, { absenderId: pf2.id, sendStatus: 'gesendet' });
    m.status.setzeLeadStatus(l.id, 'interessiert');
    const kopie = alle(z.id)[0];
    const gesendet: string[] = [];
    const sender = async (raw: string) => {
      gesendet.push(raw);
      return { id: 'm1', threadId: 't1' };
    };
    // Mittags an einem Wochentag (Berlin), mit festem Zufall
    const res = await m.loop.runSendTick({ now: new Date('2026-07-15T10:00:00Z'), sender, zufall: () => 0 });
    expect(res.sent).toBe(1);
    expect(holen(kopie.id)).toMatchObject({ sendStatus: 'gesendet', absenderId: pf2.id });
    expect(pf1.id).not.toBe(pf2.id);
  });
});
