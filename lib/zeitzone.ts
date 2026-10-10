import { kanonischeZeitzone } from './time';

// Zeitzone eines Leads aus Import-Angaben ableiten: Zeitzone-Spalte, Land oder Länder-TLD (reine Funktionen)

/** Häufige Zeitzonen für die Auswahl in der Oberfläche (Freitext bleibt möglich) */
export const GAENGIGE_ZEITZONEN = [
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Stockholm',
  'Europe/Copenhagen',
  'Europe/Oslo',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Istanbul',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
] as const;

/** ISO-Code (klein, 'uk' wie 'gb') → Haupt-Zeitzone; bei mehreren Zonen die bevölkerungsreichste */
const ISO_ZONE: Record<string, string> = {
  de: 'Europe/Berlin',
  at: 'Europe/Vienna',
  ch: 'Europe/Zurich',
  li: 'Europe/Vaduz',
  gb: 'Europe/London',
  ie: 'Europe/Dublin',
  fr: 'Europe/Paris',
  nl: 'Europe/Amsterdam',
  be: 'Europe/Brussels',
  lu: 'Europe/Luxembourg',
  it: 'Europe/Rome',
  es: 'Europe/Madrid',
  pt: 'Europe/Lisbon',
  pl: 'Europe/Warsaw',
  cz: 'Europe/Prague',
  sk: 'Europe/Bratislava',
  hu: 'Europe/Budapest',
  si: 'Europe/Ljubljana',
  hr: 'Europe/Zagreb',
  dk: 'Europe/Copenhagen',
  se: 'Europe/Stockholm',
  no: 'Europe/Oslo',
  fi: 'Europe/Helsinki',
  ee: 'Europe/Tallinn',
  lv: 'Europe/Riga',
  lt: 'Europe/Vilnius',
  ro: 'Europe/Bucharest',
  bg: 'Europe/Sofia',
  gr: 'Europe/Athens',
  tr: 'Europe/Istanbul',
  ua: 'Europe/Kyiv',
  us: 'America/New_York',
  ca: 'America/Toronto',
  mx: 'America/Mexico_City',
  br: 'America/Sao_Paulo',
  ar: 'America/Argentina/Buenos_Aires',
  cl: 'America/Santiago',
  co: 'America/Bogota',
  au: 'Australia/Sydney',
  nz: 'Pacific/Auckland',
  jp: 'Asia/Tokyo',
  cn: 'Asia/Shanghai',
  hk: 'Asia/Hong_Kong',
  sg: 'Asia/Singapore',
  in: 'Asia/Kolkata',
  ae: 'Asia/Dubai',
  il: 'Asia/Jerusalem',
  za: 'Africa/Johannesburg',
  ru: 'Europe/Moscow',
};

/** Ländernamen (deutsch/englisch, normalisiert) → ISO-Code */
const NAME_ISO: Record<string, string> = {
  deutschland: 'de', germany: 'de',
  oesterreich: 'at', austria: 'at',
  schweiz: 'ch', switzerland: 'ch',
  liechtenstein: 'li',
  grossbritannien: 'gb', vereinigteskoenigreich: 'gb', unitedkingdom: 'gb', greatbritain: 'gb', england: 'gb', schottland: 'gb', scotland: 'gb', wales: 'gb',
  irland: 'ie', ireland: 'ie',
  frankreich: 'fr', france: 'fr',
  niederlande: 'nl', netherlands: 'nl', holland: 'nl',
  belgien: 'be', belgium: 'be',
  luxemburg: 'lu', luxembourg: 'lu',
  italien: 'it', italy: 'it',
  spanien: 'es', spain: 'es',
  portugal: 'pt',
  polen: 'pl', poland: 'pl',
  tschechien: 'cz', czechia: 'cz', czechrepublic: 'cz',
  slowakei: 'sk', slovakia: 'sk',
  ungarn: 'hu', hungary: 'hu',
  slowenien: 'si', slovenia: 'si',
  kroatien: 'hr', croatia: 'hr',
  daenemark: 'dk', denmark: 'dk',
  schweden: 'se', sweden: 'se',
  norwegen: 'no', norway: 'no',
  finnland: 'fi', finland: 'fi',
  estland: 'ee', estonia: 'ee',
  lettland: 'lv', latvia: 'lv',
  litauen: 'lt', lithuania: 'lt',
  rumaenien: 'ro', romania: 'ro',
  bulgarien: 'bg', bulgaria: 'bg',
  griechenland: 'gr', greece: 'gr',
  tuerkei: 'tr', turkey: 'tr', turkiye: 'tr',
  ukraine: 'ua',
  usa: 'us', vereinigtestaaten: 'us', unitedstates: 'us', unitedstatesofamerica: 'us', amerika: 'us',
  kanada: 'ca', canada: 'ca',
  mexiko: 'mx', mexico: 'mx',
  brasilien: 'br', brazil: 'br',
  argentinien: 'ar', argentina: 'ar',
  chile: 'cl',
  kolumbien: 'co', colombia: 'co',
  australien: 'au', australia: 'au',
  neuseeland: 'nz', newzealand: 'nz',
  japan: 'jp',
  china: 'cn',
  hongkong: 'hk',
  singapur: 'sg', singapore: 'sg',
  indien: 'in', india: 'in',
  vereinigtearabischeemirate: 'ae', unitedarabemirates: 'ae', uae: 'ae', emirate: 'ae',
  israel: 'il',
  suedafrika: 'za', southafrica: 'za',
  russland: 'ru', russia: 'ru',
};

/** Länder-TLD (ohne Punkt) → ISO-Code. Generische TLDs (.com, .de, .net, .org …) sind absichtlich nicht enthalten. */
const TLD_ISO: Record<string, string> = {
  at: 'at', ch: 'ch', li: 'li', uk: 'gb', ie: 'ie', fr: 'fr', nl: 'nl', be: 'be', lu: 'lu', it: 'it', es: 'es', pt: 'pt',
  pl: 'pl', cz: 'cz', sk: 'sk', hu: 'hu', si: 'si', hr: 'hr', dk: 'dk', se: 'se', no: 'no', fi: 'fi', ee: 'ee', lv: 'lv',
  lt: 'lt', ro: 'ro', bg: 'bg', gr: 'gr', tr: 'tr', ua: 'ua', us: 'us', ca: 'ca', mx: 'mx', br: 'br', ar: 'ar', cl: 'cl',
  co: 'co', au: 'au', nz: 'nz', jp: 'jp', cn: 'cn', hk: 'hk', sg: 'sg', in: 'in', ae: 'ae', il: 'il', za: 'za', ru: 'ru',
};

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]+/g, '');
}

/** Haupt-Zeitzone zu einem Land (Name oder ISO-Code, z. B. „Österreich“, „at“, „UK“); null = unbekannt. */
export function zeitzoneAusLand(land: string | null | undefined): string | null {
  const roh = (land ?? '').trim();
  if (!roh) return null;
  const klein = roh.toLowerCase();
  if (klein.length === 2) return ISO_ZONE[klein === 'uk' ? 'gb' : klein] ?? null;
  const iso = NAME_ISO[normName(roh)];
  return iso ? (ISO_ZONE[iso] ?? null) : null;
}

/** Zeitzone aus der Länder-TLD einer Domain/URL (.at, .co.uk, .fr …); generische TLDs (.com, .de, .net) liefern null. */
export function zeitzoneAusTld(hostOderUrl: string | null | undefined): string | null {
  let host = (hostOderUrl ?? '').trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^.*@/, '');
  host = host.split(/[/?#:\s]/)[0].replace(/\.$/, '');
  const tld = host.split('.').pop() ?? '';
  const iso = TLD_ISO[tld];
  return iso ? (ISO_ZONE[iso] ?? null) : null;
}

export type ZeitzoneQuelle = 'angabe' | 'land' | 'email_tld' | 'website_tld';

export type ZeitzoneErgebnis = {
  /** Kanonische IANA-Zone; null = keine Angabe/Schätzung → Zeitzone der Kampagne */
  zeitzone: string | null;
  quelle: ZeitzoneQuelle | null;
  /** Angegebene Zeitzone war ungültig und wurde ignoriert */
  ungueltig?: string;
};

/**
 * Reihenfolge: Zeitzone-Spalte → Land-Spalte → TLD der Website → TLD der E-Mail-Domain.
 * Ohne Treffer null (= Kampagnen-Zeitzone).
 */
export function bestimmeZeitzone(i: { zeitzone?: string; land?: string; email?: string; website?: string }): ZeitzoneErgebnis {
  const angabe = (i.zeitzone ?? '').trim();
  let ungueltig: string | undefined;
  if (angabe) {
    const z = kanonischeZeitzone(angabe);
    if (z) return { zeitzone: z, quelle: 'angabe' };
    ungueltig = angabe;
  }
  const mitHinweis = (e: ZeitzoneErgebnis): ZeitzoneErgebnis => (ungueltig ? { ...e, ungueltig } : e);
  const land = zeitzoneAusLand(i.land);
  if (land) return mitHinweis({ zeitzone: land, quelle: 'land' });
  const web = zeitzoneAusTld(i.website);
  if (web) return mitHinweis({ zeitzone: web, quelle: 'website_tld' });
  const mail = zeitzoneAusTld((i.email ?? '').split('@')[1]);
  if (mail) return mitHinweis({ zeitzone: mail, quelle: 'email_tld' });
  return mitHinweis({ zeitzone: null, quelle: null });
}

export const ZEITZONE_QUELLE_LABEL: Record<ZeitzoneQuelle, string> = {
  angabe: 'Spalte Zeitzone',
  land: 'aus Land',
  website_tld: 'aus Website-Endung',
  email_tld: 'aus E-Mail-Endung',
};
