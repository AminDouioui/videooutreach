// Fehlerklassifizierung für Gmail-API-Antworten (rein, ohne googleapis-Import)

export type GmailFehlerArt = 'quota' | 'ungueltiger_empfaenger' | 'auth' | 'sonstig';

export type GmailFehler = { art: GmailFehlerArt; meldung: string };

type Gaxios = {
  code?: number | string;
  status?: number;
  message?: string;
  errors?: { reason?: string; message?: string }[];
  response?: { status?: number; data?: { error?: string | { message?: string; errors?: { reason?: string }[] } } };
};

const QUOTA_GRUENDE = ['ratelimitexceeded', 'userratelimitexceeded', 'dailylimitexceeded', 'quotaexceeded', 'sendinglimitexceeded'];

/** Ordnet einen Fehler der Gmail-API einer Kategorie zu. */
export function classifyGmailError(e: unknown): GmailFehler {
  const err = (e ?? {}) as Gaxios;
  const status = Number(err.response?.status ?? err.status ?? (typeof err.code === 'number' ? err.code : err.code && /^\d+$/.test(String(err.code)) ? err.code : NaN));
  const data = err.response?.data?.error;
  const gruende = [
    ...(err.errors ?? []).map((x) => x.reason ?? ''),
    ...(typeof data === 'object' && data?.errors ? data.errors.map((x) => x.reason ?? '') : []),
  ].map((r) => r.toLowerCase());
  const text = String(err.message ?? (typeof data === 'object' ? data?.message : data) ?? e ?? 'Unbekannter Fehler');
  const lower = text.toLowerCase();

  if (status === 429 || gruende.some((g) => QUOTA_GRUENDE.includes(g)) || QUOTA_GRUENDE.some((g) => lower.includes(g))) {
    return { art: 'quota', meldung: `Gmail-Limit erreicht: ${text}` };
  }
  if (lower.includes('invalid_grant') || lower.includes('invalid_client') || lower.includes('unauthorized_client') || status === 401) {
    return { art: 'auth', meldung: `Gmail-Authentifizierung fehlgeschlagen (bitte neu verbinden): ${text}` };
  }
  if (status === 400 && (lower.includes('invalid to') || lower.includes('recipient') || gruende.includes('invalidargument'))) {
    return { art: 'ungueltiger_empfaenger', meldung: `Ungültige Empfängeradresse: ${text}` };
  }
  if (status === 403 && gruende.length === 0 && lower.includes('insufficient')) {
    return { art: 'auth', meldung: `Gmail-Berechtigung fehlt: ${text}` };
  }
  return { art: 'sonstig', meldung: text.slice(0, 500) };
}
