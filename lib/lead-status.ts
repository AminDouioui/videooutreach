// Lead-Status (manueller Vertriebsstatus), Flow-Stopp-Regeln und Firmen-Domain-Logik – reine Logik, auch im Browser nutzbar

export const LEAD_STATUS = ['offen', 'interessiert', 'termin_gebucht', 'spaeter', 'nicht_interessiert', 'falscher_ansprechpartner', 'gewonnen', 'verloren'] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

/** Farbnamen wie in components/Badge.tsx */
export type BadgeFarbe = 'grau' | 'gruen' | 'gelb' | 'rot' | 'blau';

export const LEAD_STATUS_INFO: Record<LeadStatus, { label: string; farbe: BadgeFarbe; beendetFlow: boolean }> = {
  offen: { label: 'Offen', farbe: 'grau', beendetFlow: false },
  interessiert: { label: 'Interessiert', farbe: 'gruen', beendetFlow: false },
  termin_gebucht: { label: 'Termin gebucht', farbe: 'gruen', beendetFlow: true },
  spaeter: { label: 'Später', farbe: 'gelb', beendetFlow: false },
  nicht_interessiert: { label: 'Nicht interessiert', farbe: 'rot', beendetFlow: true },
  falscher_ansprechpartner: { label: 'Falscher Ansprechpartner', farbe: 'gelb', beendetFlow: true },
  gewonnen: { label: 'Gewonnen', farbe: 'blau', beendetFlow: true },
  verloren: { label: 'Verloren', farbe: 'rot', beendetFlow: true },
};

export function istLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === 'string' && (LEAD_STATUS as readonly string[]).includes(v);
}

export function leadStatusLabel(status: string): string {
  return istLeadStatus(status) ? LEAD_STATUS_INFO[status].label : status;
}

/** Status, die den Flow beenden (keine Follow-ups, Erstmail wird übersprungen) */
export const FLOW_ENDENDE_STATUS: LeadStatus[] = LEAD_STATUS.filter((s) => LEAD_STATUS_INFO[s].beendetFlow);

export function statusBeendetFlow(status: string): boolean {
  return istLeadStatus(status) && LEAD_STATUS_INFO[status].beendetFlow;
}

/** Fehlertext einer wegen des Lead-Status übersprungenen Erstmail */
export const STATUS_SKIP_PREFIX = 'Lead-Status: ';
export const FIRMA_HAT_GEANTWORTET = 'Firma hat geantwortet';

export type StatusLeadZustand = {
  flowStopp: string | null;
  sendStatus: string;
  sendError: string | null;
};

export type StatusPatch = {
  flowStopp?: 'status' | null;
  flowStoppAt?: Date | null;
  sendStatus?: 'uebersprungen' | 'nicht_gesendet';
  sendError?: string | null;
};

/**
 * Was ändert sich am Lead, wenn der Lead-Status auf `neu` gesetzt wird?
 * - Flow-beendender Status: Flow stoppen (außer es ist schon aus anderem Grund gestoppt) und eine noch nicht
 *   gesendete Erstmail überspringen.
 * - Anderer Status: nur ein durch den Status gesetzter Stopp (flowStopp = 'status') wird aufgehoben; Stopps durch
 *   Antwort, Bounce, Abmeldung oder Firmen-Antwort bleiben bestehen.
 */
export function statusPatch(lead: StatusLeadZustand, neu: LeadStatus, jetzt: Date): StatusPatch {
  const patch: StatusPatch = {};
  if (LEAD_STATUS_INFO[neu].beendetFlow) {
    if (!lead.flowStopp) {
      patch.flowStopp = 'status';
      patch.flowStoppAt = jetzt;
    }
    if (lead.sendStatus === 'nicht_gesendet' || lead.sendStatus === 'geplant') {
      patch.sendStatus = 'uebersprungen';
      patch.sendError = `${STATUS_SKIP_PREFIX}${LEAD_STATUS_INFO[neu].label}`;
    }
  } else {
    if (lead.flowStopp === 'status') {
      patch.flowStopp = null;
      patch.flowStoppAt = null;
    }
    if (lead.sendStatus === 'uebersprungen' && lead.sendError?.startsWith(STATUS_SKIP_PREFIX)) {
      patch.sendStatus = 'nicht_gesendet';
      patch.sendError = null;
    }
  }
  return patch;
}

// ---------------------------------------------------------------- Firmen-Domain

/** Private/öffentliche Mail-Anbieter: gleiche Domain heißt nicht gleiche Firma */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'gmx.de',
  'gmx.net',
  'gmx.at',
  'gmx.ch',
  'gmx.com',
  'web.de',
  't-online.de',
  'outlook.com',
  'outlook.de',
  'hotmail.com',
  'hotmail.de',
  'live.com',
  'live.de',
  'msn.com',
  'yahoo.com',
  'yahoo.de',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'aol.de',
  'freenet.de',
  'posteo.de',
  'posteo.net',
  'mail.de',
  'mail.com',
  'email.de',
  '1und1.de',
  'online.de',
  'arcor.de',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'tutanota.com',
  'tuta.io',
  'mailbox.org',
  'kabelmail.de',
  'vodafone.de',
  'ewetel.net',
]);

/** Kleingeschriebene Domain einer Adresse oder null */
export function emailDomain(email: string): string | null {
  const t = email.trim().toLowerCase();
  const i = t.lastIndexOf('@');
  if (i < 1 || i === t.length - 1) return null;
  return t.slice(i + 1);
}

export function istFreemail(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/** Domain, über die Kollegen einer Firma erkannt werden – null bei Freemail oder ungültiger Adresse */
export function firmenDomain(email: string): string | null {
  const d = emailDomain(email);
  return d && !istFreemail(d) ? d : null;
}

/** Link zum Gmail-Thread (Konto 0) */
export function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}
