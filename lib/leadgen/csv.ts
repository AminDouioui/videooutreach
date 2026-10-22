import type { ErgebnisZeile } from './ergebnisse';

/** Eine CSV-Zelle (`;` getrennt) mit Schutz vor Formel-Injection in Excel (wie beim Kampagnen-Export). */
export function csvZelle(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const EMAIL_STATUS_LABEL: Record<string, string> = {
  gueltig: 'verifiziert',
  catch_all_best_guess: 'catch-all, unverifiziert (best guess)',
  generisch: 'generisches Postfach (unpersönlich), geprüft',
  generisch_unverifiziert: 'generisches Postfach (unpersönlich), ungeprüft',
};

/** CSV des Ergebnisses mit Herkunft und Konfidenz: UTF-8 mit BOM (Excel), `;` getrennt. */
export function ergebnisCsv(zeilen: ErgebnisZeile[]): string {
  const kopf = [
    'Firma', 'Straße', 'PLZ', 'Ort', 'Bundesland', 'Website', 'Branche', 'Branche Konfidenz', 'Mitarbeiter', 'Mitarbeiter Typ', 'Mitarbeiter Klasse', 'Vorname', 'Nachname', 'Rolle', 'Rolle Treffer',
    'E-Mail', 'E-Mail Status', 'E-Mail Konfidenz', 'E-Mail Muster', 'Telefon Zentrale', 'Telefon weitere', 'Score Gesamt', 'Score ICP', 'Score Daten', 'Hinweise', 'Quellen',
  ];
  const rows = zeilen.map((z) => [
    z.firma, z.strasse, z.plz, z.ort, z.bundesland, z.domain ? `https://${z.domain}` : '', z.branche, z.brancheKonfidenz?.toFixed(2), z.mitarbeiter?.zahl, z.mitarbeiter?.typ, z.mitarbeiter?.klasse,
    z.person?.vorname, z.person?.nachname, z.person?.rolleText, z.person?.rollenTreffer,
    z.email?.adresse, z.email ? (EMAIL_STATUS_LABEL[z.email.status] ?? z.email.status) : '', z.email?.konfidenz.toFixed(2), z.email?.muster,
    z.telefone.find((t) => t.art === 'zentrale')?.wert ?? '', z.telefone.filter((t) => t.art !== 'zentrale').map((t) => `${t.wert}${t.art ? ` (${t.art})` : ''}`).join(', '),
    z.scores.gesamt, z.scores.icp, z.scores.daten, z.hinweise.join(', '),
    [...new Set([...(z.email?.quellen ?? []), ...Object.values(z.herkunft).map((h) => h.quelle)])].join(' | '),
  ]);
  return '﻿' + [kopf, ...rows].map((r) => r.map(csvZelle).join(';')).join('\r\n') + '\r\n';
}
