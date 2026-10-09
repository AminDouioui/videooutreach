import { istLeadStatus, LEAD_STATUS_INFO } from '@/lib/lead-status';

const FARBEN: Record<string, string> = {
  grau: 'bg-slate-100 text-slate-700',
  gruen: 'bg-green-100 text-green-800',
  gelb: 'bg-amber-100 text-amber-800',
  rot: 'bg-red-100 text-red-800',
  blau: 'bg-indigo-100 text-indigo-800',
};

const ZUORDNUNG: Record<string, [string, string]> = {
  // Render-Status
  wartet: ['Wartet', 'grau'],
  rendert: ['Rendert', 'blau'],
  fertig: ['Fertig', 'gruen'],
  fehler: ['Fehler', 'rot'],
  // Versand-Status
  nicht_gesendet: ['Nicht gesendet', 'grau'],
  geplant: ['Geplant', 'gelb'],
  gesendet: ['Gesendet', 'gruen'],
  uebersprungen: ['Übersprungen', 'grau'],
  // Flow-Stopp
  beantwortet: ['Beantwortet', 'gruen'],
  bounce: ['Bounce', 'rot'],
  abgemeldet: ['Abgemeldet', 'grau'],
  status: ['Per Lead-Status beendet', 'grau'],
  firma_beantwortet: ['Firma hat geantwortet', 'gelb'],
  // Kampagnen-Status
  entwurf: ['Entwurf', 'grau'],
  bereit: ['Bereit', 'gruen'],
  versendet_laufend: ['Versand läuft', 'blau'],
  pausiert: ['Pausiert', 'gelb'],
  abgeschlossen: ['Abgeschlossen', 'gruen'],
};

export function Badge({ status }: { status: string }) {
  const [label, farbe] = ZUORDNUNG[status] ?? [status, 'grau'];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${FARBEN[farbe]}`}>{label}</span>;
}

/** Badge für den Lead-Status (offen, interessiert …) */
export function LeadStatusBadge({ status }: { status: string }) {
  const info = istLeadStatus(status) ? LEAD_STATUS_INFO[status] : { label: status, farbe: 'grau' as const };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${FARBEN[info.farbe]}`}>{info.label}</span>;
}
