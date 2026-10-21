// Typische Einwände auf Kaltakquise-Mails und passende Konter (rein, auch im Browser nutzbar). Die KI ordnet einen Einwand
// ein; der Konter fließt als Leitlinie in den Antwort-Entwurf. Die Texte sind Standardvorschläge: Prozessia kann sie unter
// Einstellungen überschreiben (Setting `einwand_konter`, JSON). Sie behaupten bewusst nichts Überprüfbares.

export const EINWAENDE = ['kein_bedarf', 'schon_loesung', 'kein_budget', 'keine_zeit', 'kein_entscheider', 'datenschutz_skepsis', 'kein_einwand'] as const;
export type Einwand = (typeof EINWAENDE)[number];

export const EINWAND_LABEL: Record<Einwand, string> = {
  kein_bedarf: 'Kein Bedarf',
  schon_loesung: 'Haben schon eine Lösung',
  kein_budget: 'Kein Budget / zu teuer',
  keine_zeit: 'Keine Zeit',
  kein_entscheider: 'Nicht der Entscheider',
  datenschutz_skepsis: 'Datenschutz / Skepsis gegenüber KI',
  kein_einwand: 'Kein Einwand',
};

export function istEinwand(v: unknown): v is Einwand {
  return typeof v === 'string' && (EINWAENDE as readonly string[]).includes(v);
}

export const STANDARD_KONTER: Record<Exclude<Einwand, 'kein_einwand'>, string> = {
  kein_bedarf: 'Gerade wenn es heute reibungslos läuft, lohnt ein kurzer Blick von außen. Die kostenlose Potenzialanalyse zeigt in kurzer Zeit, ob es sich lohnt, und wenn nicht, sagen wir das ehrlich.',
  schon_loesung: 'Die bestehende Lösung muss nicht ersetzt werden. Es geht um die manuelle Arbeit rund um das vorhandene System, die sich oft automatisieren lässt. Danach fragen, wo heute noch von Hand nachgearbeitet wird.',
  kein_budget: 'Die Potenzialanalyse ist kostenlos und unverbindlich. Erst danach steht fest, was sich rechnet, und bis dahin entsteht keine Verpflichtung.',
  keine_zeit: 'Der erste Schritt kostet nur wenige Minuten, die Vorbereitung übernimmt Prozessia. Einen späteren Zeitpunkt anbieten.',
  kein_entscheider: 'Freundlich danken und fragen, wer im Haus der richtige Ansprechpartner ist, und darum bitten, die Anfrage dorthin zu geben.',
  datenschutz_skepsis: 'Den Punkt ernst nehmen. Anbieten, im kurzen Gespräch genau zu klären, welche Daten verarbeitet werden und wo. Keine Details zum Hosting oder zu Zertifizierungen behaupten.',
};

/** Konter für einen Einwand: Überschreibung aus den Einstellungen gewinnt, sonst der Standard; kein_einwand hat keinen. */
export function konterFuer(einwand: string | null | undefined, ueberschreibungen: Partial<Record<string, string>> = {}): string | null {
  if (!istEinwand(einwand) || einwand === 'kein_einwand') return null;
  return ueberschreibungen[einwand]?.trim() || STANDARD_KONTER[einwand];
}

/** JSON der Einstellung → nur bekannte Einwände mit nicht leerem Text */
export function parseKonterEinstellung(json: string | null | undefined): Partial<Record<Einwand, string>> {
  if (!json) return {};
  try {
    const roh = JSON.parse(json) as Record<string, unknown>;
    const aus: Partial<Record<Einwand, string>> = {};
    for (const e of EINWAENDE) {
      const t = roh[e];
      if (e !== 'kein_einwand' && typeof t === 'string' && t.trim()) aus[e] = t.trim().slice(0, 1500);
    }
    return aus;
  } catch {
    return {};
  }
}
