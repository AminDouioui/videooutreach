import { z } from 'zod';

// Props der Kompositionen – gemeinsam für Remotion und Worker
export const outreachPropsSchema = z.object({
  firma: z.string(),
  anrede: z.string().default(''),
  vorname: z.string().default(''),
  nachname: z.string().default(''),
  logoUrl: z.string().url().optional(),
  websiteScreenshotUrl: z.string().url().optional(),
});

export type OutreachProps = z.infer<typeof outreachPropsSchema>;

export const FPS = 30;
export const BREITE = 1280;
export const HOEHE = 720;
/** Länge des personalisierten Intros (5 s) */
export const INTRO_FRAMES = 150;
/** Überblendung Intro -> Teaser */
export const UEBERBLENDUNG_FRAMES = 12;
/** Teaser-Länge als Fallback (58,7 s), tatsächliche Länge wird per calculateMetadata gelesen */
export const TEASER_FRAMES_FALLBACK = 1761;
export const TEASER_DATEI = 'teaser.mp4';

export const MARKE = {
  text: '#0a0a0a',
  akzent: '#7b3aec',
  grau: '#6b6b76',
  hintergrund: '#ffffff',
};

export const standardProps: OutreachProps = {
  firma: 'Musterbau GmbH',
  anrede: '',
  vorname: 'Max',
  nachname: 'Mustermann',
};

/** Begrüßung wie überall: „Guten Tag Vorname Nachname“ bzw. „Guten Tag“ */
export function begruessung(p: Pick<OutreachProps, 'vorname' | 'nachname'>): string {
  const name = [p.vorname, p.nachname].filter((s) => s.trim()).join(' ').trim();
  return name ? `Guten Tag ${name}` : 'Guten Tag';
}
