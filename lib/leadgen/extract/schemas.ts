import { z } from 'zod';
import { aus } from './provider';

// Schemas der LLM-Extraktion. Jedes Schema wird einmal als zod-Typ definiert; das JSON-Schema für Structured Outputs entsteht daraus.

export const TELEFON_ARTEN = ['zentrale', 'durchwahl', 'mobil', 'fax', 'unbekannt'] as const;
export const BRANCHEN = ['werkzeugbau', 'formenbau', 'maschinenbau', 'sonstige_fertigung', 'keine_fertigung'] as const;
export type Branche = (typeof BRANCHEN)[number];

const personenZod = z.object({
  personen: z.array(
    z.object({
      vorname: z.string().nullable(),
      nachname: z.string(),
      rolle: z.string(),
      email: z.string().nullable(),
      telefon: z.string().nullable(),
      telefonArt: z.enum(TELEFON_ARTEN).nullable(),
    }),
  ),
  telefone: z.array(z.object({ nummer: z.string(), art: z.enum(TELEFON_ARTEN) })),
});
export type PersonenExtraktion = z.infer<typeof personenZod>;

export const PERSONEN_SCHEMA = aus(
  'personen',
  'Nenne alle namentlich genannten Personen mit ihrer Rolle (z. B. Geschäftsführer, Prokurist, Leiter Einkauf, Leiter Fertigung, Vertriebsleiter). ' +
    '„rolle“ ist die Bezeichnung exakt wie im Text. „email“ und „telefon“ nur, wenn sie eindeutig zu dieser Person gehören (steht direkt bei ihr), sonst null. ' +
    'Aus der Liste „telefone“ bestimme für jede im Text stehende Nummer die Art: zentrale (Hauptnummer/Telefon), durchwahl, mobil, fax oder unbekannt. ' +
    'Vor- und Nachname getrennt, Titel (Dr., Prof.) weglassen.',
  personenZod,
  z.toJSONSchema(personenZod) as Record<string, unknown>,
);

const brancheZod = z.object({ branche: z.enum(BRANCHEN), konfidenz: z.number().min(0).max(1), beleg: z.string() });
export type BrancheExtraktion = z.infer<typeof brancheZod>;

export const BRANCHEN_SCHEMA = aus(
  'branche',
  'Ordne das Unternehmen anhand des Textes genau einer Branche zu: werkzeugbau (Werkzeuge, Stanz-/Umform-/Schneidwerkzeuge, Vorrichtungen), formenbau (Spritzgieß-, Druckguss-, Kunststoffformen), ' +
    'maschinenbau (Maschinen und Anlagen), sonstige_fertigung (andere Fertigung, Lohnfertigung, Zerspanung, Metallbau), keine_fertigung (alles andere, z. B. Handel oder Dienstleistung). ' +
    '„konfidenz“ zwischen 0 und 1. „beleg“ ist ein kurzes WÖRTLICHES Zitat (mindestens 8 Zeichen, höchstens ein Satz) aus dem Text, das die Zuordnung stützt.',
  brancheZod,
  z.toJSONSchema(brancheZod) as Record<string, unknown>,
);

const personenRolleZod = z.object({
  personen: z.array(z.object({ vorname: z.string().nullable(), nachname: z.string(), rolle: z.string() })),
});
export type PersonenRolleExtraktion = z.infer<typeof personenRolleZod>;

/** Für Treffer der Personensuche (Stellenanzeigen, Pressemitteilungen, Ausstellerlisten, Profil-Snippets): Name und exakte Rollenbezeichnung. */
export const PERSONEN_ROLLE_SCHEMA = aus(
  'personen_rolle',
  'Nenne alle namentlich genannten Personen dieser Firma mit ihrer Rolle. „rolle“ ist die Bezeichnung exakt wie im Text (z. B. „Leiter Einkauf“). ' +
    'Nur Personen, die laut Text bei der genannten Firma arbeiten. Vor- und Nachname getrennt, Titel weglassen. Keine Personen anderer Firmen.',
  personenRolleZod,
  z.toJSONSchema(personenRolleZod) as Record<string, unknown>,
);
