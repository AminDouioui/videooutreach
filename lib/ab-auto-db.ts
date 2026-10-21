import { and, eq } from 'drizzle-orm';
import { bewerteVarianten } from './ab-auto';
import { getDb, schema } from './db';
import { ladeVariantenStatistik } from './varianten-statistik';

// A/B-Automatik: bewertet laufende Kampagnen mit eingeschalteter Automatik, schaltet schwache Varianten ab und protokolliert

const STUNDE_MS = 3600_000;
let letzterLauf = 0;

export type AbErgebnis = { campaignId: number; abgeschaltet: string[]; aUnterlegen: boolean };

/** Bewertet eine Kampagne und wendet das Ergebnis an. Idempotent: schon abgeschaltete Varianten und eine schon gemeldete A-Schwäche erscheinen nicht erneut. */
export function wendeAbAutomatikAn(campaignId: number, jetzt: Date = new Date()): AbErgebnis {
  const db = getDb();
  const k = db.select({ abAutoLog: schema.campaigns.abAutoLog }).from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).get();
  const stat = ladeVariantenStatistik(campaignId);
  const b = bewerteVarianten(stat.map((s) => ({ kuerzel: s.kuerzel, aktiv: s.aktiv, gesendet: s.gesendet, antworten: s.antworten })));
  const log = [...(k?.abAutoLog ?? [])];
  const abgeschaltet: string[] = [];
  for (const e of b.abschalten) {
    const r = db.update(schema.varianten).set({ aktiv: false }).where(and(eq(schema.varianten.campaignId, campaignId), eq(schema.varianten.kuerzel, e.kuerzel), eq(schema.varianten.aktiv, true))).run();
    if (r.changes > 0) {
      abgeschaltet.push(e.kuerzel);
      log.push({ at: jetzt.getTime(), kuerzel: e.kuerzel, grund: `Abgeschaltet: ${e.grund}` });
    }
  }
  let aUnterlegen = false;
  if (b.aUnterlegen && !log.some((l) => l.kuerzel === 'A' && l.grund.includes(`Variante ${b.fuehrend} `))) {
    aUnterlegen = true;
    log.push({ at: jetzt.getTime(), kuerzel: 'A', grund: `Hinweis: ${b.aUnterlegen.grund}. Variante A ist die Kampagnen-Vorlage und bleibt aktiv; ihren Text bei Bedarf selbst anpassen.` });
  }
  if (abgeschaltet.length || aUnterlegen) db.update(schema.campaigns).set({ abAutoLog: log.slice(-50) }).where(eq(schema.campaigns.id, campaignId)).run();
  return { campaignId, abgeschaltet, aUnterlegen };
}

/** Läuft höchstens stündlich über alle laufenden Kampagnen mit eingeschalteter Automatik (aus dem Versand-Durchlauf). */
export function abAutomatik(jetzt: Date = new Date(), log?: (msg: string) => void): AbErgebnis[] {
  if (jetzt.getTime() - letzterLauf < STUNDE_MS) return [];
  letzterLauf = jetzt.getTime();
  try {
    const ids = getDb()
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.abAuto, true), eq(schema.campaigns.status, 'versendet_laufend')))
      .all();
    const ergebnisse = ids.map((c) => wendeAbAutomatikAn(c.id, jetzt)).filter((r) => r.abgeschaltet.length > 0 || r.aUnterlegen);
    for (const r of ergebnisse) log?.(`A/B-Automatik Kampagne ${r.campaignId}: abgeschaltet ${r.abgeschaltet.join(', ') || 'nichts'}${r.aUnterlegen ? ', Variante A unterlegen' : ''}`);
    return ergebnisse;
  } catch (e) {
    log?.(`A/B-Automatik: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/** Nur für Tests: Drosselung zurücksetzen */
export function setzeAbDrosselungZurueck(): void {
  letzterLauf = 0;
}
