/** Teilt einen vollen Namen: Nachname = letztes Wort, Vorname = alles davor. */
export function splitName(voll: string): { vorname: string; nachname: string } {
  const teile = voll.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return { vorname: '', nachname: '' };
  if (teile.length === 1) return { vorname: '', nachname: teile[0] };
  return { vorname: teile.slice(0, -1).join(' '), nachname: teile[teile.length - 1] };
}

/** „Guten Tag {Vorname} {Nachname}“ bzw. „Guten Tag“ ohne Namen. */
export function begruessung(lead: { vorname?: string | null; nachname?: string | null }): string {
  const name = [lead.vorname, lead.nachname]
    .map((t) => (t ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return name ? `Guten Tag ${name}` : 'Guten Tag';
}
