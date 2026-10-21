// Firmenlogo für das personalisierte Intro: kommt als URL aus einer Importspalte (`logo` oder `logo_url`). Bevor Remotion
// es lädt, wird die URL geprüft; jedes Problem führt nur dazu, dass das Intro ohne Logo gerendert wird (nie zu einem
// Renderfehler). Schutz: nur https, keine IP-Adressen, kein localhost/intern, nur Bilder, höchstens 2 MB.

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_SPALTEN = ['logo', 'logo_url', 'logourl'];
const INTERN = /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/i;

/** Logo-URL aus den Zusatzspalten eines Leads (Spaltennamen normalisiert), oder null. Prüft nur die Form der URL. */
export function logoUrlAusExtra(extra: Record<string, unknown> | null | undefined): string | null {
  for (const [name, wert] of Object.entries(extra ?? {})) {
    const key = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!LOGO_SPALTEN.includes(key)) continue;
    const url = pruefeLogoAdresse(String(wert ?? ''));
    if (url) return url;
  }
  return null;
}

/** https-URL mit öffentlichem Hostnamen (kein IP-Literal, kein localhost/intern) oder null. */
export function pruefeLogoAdresse(roh: string): string | null {
  const t = roh.trim();
  if (!t || t.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || INTERN.test(host)) return null;
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return null; // IPv4/IPv6-Literal
  return u.toString();
}

export type LogoFetch = (url: string, init: { signal: AbortSignal; redirect: 'follow' }) => Promise<{ ok: boolean; url: string; headers: { get(n: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * Prüft, ob unter der URL wirklich ein kleines Bild liegt (Zeitlimit 6 s). Liefert die URL oder null. Auch das Ziel nach
 * Weiterleitungen muss eine zulässige Adresse sein.
 */
export async function pruefeLogoErreichbar(url: string, fetchFn: LogoFetch = fetch as unknown as LogoFetch, zeitlimitMs = 6000): Promise<string | null> {
  const erlaubt = pruefeLogoAdresse(url);
  if (!erlaubt) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), zeitlimitMs);
  try {
    const res = await fetchFn(erlaubt, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok || !pruefeLogoAdresse(res.url || erlaubt)) return null;
    const typ = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)/.test(typ)) return null;
    const laenge = Number(res.headers.get('content-length'));
    if (Number.isFinite(laenge) && laenge > LOGO_MAX_BYTES) return null;
    const bytes = (await res.arrayBuffer()).byteLength;
    return bytes > 0 && bytes <= LOGO_MAX_BYTES ? erlaubt : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
