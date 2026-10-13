// Kurze Zeitangabe für Tabellen und Listen (ohne Node-Importe, auch im Browser nutzbar).

const KURZ = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const VOLL = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'medium' });

/** „13.10. 14:32“ (Europe/Berlin); leer = „–“. */
export function kurzZeit(t: number | Date | null | undefined): string {
  if (t === null || t === undefined) return '–';
  return KURZ.format(t).replace(',', '');
}

/** „13.10.2026, 14:32:05“ (Europe/Berlin) für Tooltips und Details; leer = „–“. */
export function vollZeit(t: number | Date | null | undefined): string {
  if (t === null || t === undefined) return '–';
  return VOLL.format(t);
}
