// Kategorien der KI-Einordnung von Antworten – reine Daten, auch im Browser nutzbar (ohne SDK)

export const KI_KATEGORIEN = ['interessiert', 'spaeter', 'nicht_interessiert', 'falscher_ansprechpartner', 'abwesenheit', 'abmeldung', 'sonstiges'] as const;
export type KiKategorie = (typeof KI_KATEGORIEN)[number];

export const KI_KATEGORIE_LABEL: Record<KiKategorie, string> = {
  interessiert: 'Interessiert',
  spaeter: 'Später',
  nicht_interessiert: 'Nicht interessiert',
  falscher_ansprechpartner: 'Falscher Ansprechpartner',
  abwesenheit: 'Abwesenheit',
  abmeldung: 'Abmeldung',
  sonstiges: 'Sonstiges',
};
