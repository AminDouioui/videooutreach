import { getEnv } from '@/lib/env';
import { protokolliereKosten } from '../kosten';
import type { EmailVerifier, VerifizierungsErgebnis } from './verifier';

// Anbindung an check-if-email-exists (Reacher) als eigenständiger HTTP-Dienst: POST {REACHER_URL}/v0/check_email.
// Der Dienst baut die SMTP-Verbindung bis RCPT TO auf (ohne zu senden) und gehört auf einen Host mit offenem Port 25, der NICHT
// die Reputation unserer Versand-Domain trägt. Antwortformat laut Reacher-Doku (v0): is_reachable, mx, smtp, misc.

const istObjekt = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Übersetzt die Antwort des Dienstes in unseren Status. Unbekannte oder fehlerhafte Antworten ergeben ‚unbekannt‘, nie ‚gültig‘. */
export function mapReacherAntwort(json: unknown): VerifizierungsErgebnis {
  if (!istObjekt(json)) return { status: 'unbekannt', details: { grund: 'antwort_unlesbar' } };
  const mx = istObjekt(json.mx) ? json.mx : {};
  const smtp = istObjekt(json.smtp) ? json.smtp : {};
  const details = { is_reachable: json.is_reachable, accepts_mail: mx.accepts_mail, can_connect_smtp: smtp.can_connect_smtp, is_deliverable: smtp.is_deliverable, is_catch_all: smtp.is_catch_all, is_disabled: smtp.is_disabled, has_full_inbox: smtp.has_full_inbox };
  if (mx.accepts_mail === false) return { status: 'ungueltig', details: { ...details, grund: 'kein_mx' } };
  if (smtp.is_catch_all === true) return { status: 'catch_all', details };
  switch (json.is_reachable) {
    case 'safe':
      return smtp.is_deliverable === true ? { status: 'gueltig', details } : { status: 'unbekannt', details };
    case 'invalid':
      return { status: 'ungueltig', details };
    case 'risky':
      return { status: 'risky', details };
    default:
      return { status: 'unbekannt', details };
  }
}

export class ReacherVerifier implements EmailVerifier {
  readonly name = 'reacher';
  constructor(private readonly opt: { url?: string; apiKey?: string; f?: typeof fetch; runId?: number | null; zeitlimitMs?: number } = {}) {}

  async pruefe(adresse: string): Promise<VerifizierungsErgebnis> {
    const env = getEnv();
    const url = this.opt.url ?? env.REACHER_URL;
    if (!url) return { status: 'unbekannt', details: { grund: 'REACHER_URL nicht gesetzt' } };
    const key = this.opt.apiKey ?? env.REACHER_API_KEY;
    try {
      const res = await (this.opt.f ?? fetch)(`${url.replace(/\/+$/, '')}/v0/check_email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: key, 'x-reacher-secret': key } : {}) },
        body: JSON.stringify({ to_email: adresse }),
        signal: AbortSignal.timeout(this.opt.zeitlimitMs ?? 60_000),
      });
      if (!res.ok) return { status: 'unbekannt', details: { grund: `http_${res.status}` } };
      protokolliereKosten({ runId: this.opt.runId ?? null, anbieter: 'reacher', art: 'smtp_pruefung', einheiten: 1, kostenMilliCent: 0 });
      return mapReacherAntwort(await res.json());
    } catch {
      return { status: 'unbekannt', details: { grund: 'dienst_nicht_erreichbar' } };
    }
  }
}
