import dns from 'dns';

// MX-Prüfung der Empfänger-Domains beim Import (Resolver injizierbar für Tests)

/** ok = Mail-Server gefunden, kein_mx = Domain nimmt keine Mails an, unbekannt = Timeout/Netzfehler (nicht als ungültig werten) */
export type MxErgebnis = 'ok' | 'kein_mx' | 'unbekannt';

/** Resolver wie dns.promises.resolveMx/resolve4/resolve6: liefert Einträge oder wirft einen Fehler mit `code`. */
export type DnsResolver = (domain: string) => Promise<unknown[]>;

const PARALLEL = 10;
/** Gültige Ergebnisse werden so lange gemerkt (unbekannt nie) */
const CACHE_MS = 60 * 60 * 1000;

const cache = new Map<string, { ergebnis: MxErgebnis; bis: number }>();

/** Leert den Cache (für Tests). */
export function leereMxCache(): void {
  cache.clear();
}

function fehlerCode(e: unknown): string {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
}

/** Domain existiert nicht bzw. hat diesen Eintragstyp nicht (anders als Timeout/Serverfehler). */
function istNichtVorhanden(e: unknown): boolean {
  const c = fehlerCode(e);
  return c === 'ENOTFOUND' || c === 'ENODATA';
}

class ZeitUeberschreitung extends Error {}

function mitZeitlimit<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ZeitUeberschreitung('Zeitlimit')), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/** Null-MX (RFC 7505): ein einziger Eintrag mit leerem Host oder „.“ heißt „nimmt keine Mails an“. */
function istNullMx(eintraege: unknown[]): boolean {
  if (eintraege.length !== 1) return false;
  const ex = (eintraege[0] as { exchange?: unknown })?.exchange;
  return typeof ex === 'string' && (ex === '' || ex === '.');
}

async function pruefeEine(domain: string, resolveMx: DnsResolver, resolve4: DnsResolver, resolve6: DnsResolver, timeoutMs: number): Promise<MxErgebnis> {
  try {
    const mx = await mitZeitlimit(resolveMx(domain), timeoutMs);
    if (mx.length > 0) return istNullMx(mx) ? 'kein_mx' : 'ok';
    // Leere Antwort wie ENODATA behandeln (Fallback unten)
  } catch (e) {
    if (!istNichtVorhanden(e)) return 'unbekannt';
  }
  // RFC 5321: ohne MX gilt ein A-/AAAA-Eintrag als impliziter Mail-Server
  let unbekannt = false;
  for (const resolver of [resolve4, resolve6]) {
    try {
      const adressen = await mitZeitlimit(resolver(domain), timeoutMs);
      if (adressen.length > 0) return 'ok';
    } catch (e) {
      if (!istNichtVorhanden(e)) unbekannt = true;
    }
  }
  return unbekannt ? 'unbekannt' : 'kein_mx';
}

/**
 * Prüft die Domains auf Mail-Server (MX, sonst A/AAAA). Cache je Domain im Speicher, höchstens 10 Abfragen
 * gleichzeitig. Timeout und Netzfehler ergeben 'unbekannt' – solche Leads bleiben importierbar.
 */
export async function pruefeDomains(
  domains: Iterable<string>,
  resolver: DnsResolver = (d) => dns.promises.resolveMx(d),
  timeoutMs = 3000,
  aResolver: DnsResolver = (d) => dns.promises.resolve4(d),
  aaaaResolver: DnsResolver = (d) => dns.promises.resolve6(d),
): Promise<Map<string, MxErgebnis>> {
  const ergebnis = new Map<string, MxErgebnis>();
  const jetzt = Date.now();
  const offen: string[] = [];
  for (const roh of new Set([...domains].map((d) => d.trim().toLowerCase()).filter(Boolean))) {
    const treffer = cache.get(roh);
    if (treffer && treffer.bis > jetzt) ergebnis.set(roh, treffer.ergebnis);
    else offen.push(roh);
  }

  let naechste = 0;
  async function arbeiter() {
    while (naechste < offen.length) {
      const domain = offen[naechste++];
      const r = await pruefeEine(domain, resolver, aResolver, aaaaResolver, timeoutMs);
      ergebnis.set(domain, r);
      if (r !== 'unbekannt') cache.set(domain, { ergebnis: r, bis: Date.now() + CACHE_MS });
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, offen.length) }, arbeiter));
  return ergebnis;
}
