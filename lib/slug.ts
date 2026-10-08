import { randomInt } from 'crypto';

// Rechtsformen (nach Normalisierung), längere Varianten zuerst
const RECHTSFORMEN = [
  'gmbh\\s*&\\s*co\\.?\\s*kg',
  'ug\\s*\\(haftungsbeschraenkt\\)',
  'gmbh',
  'mbh',
  'ag',
  'kgaa',
  'kg',
  'ohg',
  'gbr',
  'e\\.\\s*k\\.?',
  'ek',
  'e\\.\\s*v\\.?',
  'ug',
  'se',
  'ltd\\.?',
  'inc\\.?',
  '&\\s*co\\.?',
  'co\\.',
];

const RECHTSFORM_REGEX = new RegExp(`(?<![a-z0-9])(?:${RECHTSFORMEN.join('|')})(?![a-z0-9])`, 'g');

export const SLUG_MAX_LAENGE = 30;

/** Basis des Slugs aus dem Firmennamen (ohne Zufallssuffix). */
export function slugBase(firma: string): string {
  let s = firma
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  s = s.replace(RECHTSFORM_REGEX, ' ');
  s = s
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LAENGE)
    .replace(/-+$/g, '');
  return s || 'video';
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function zufallsSuffix(): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Erzeugt `${base}-${4 Zeichen}` und wiederholt, bis `exists` false liefert. */
export function createSlug(firma: string, exists: (slug: string) => boolean): string {
  const base = slugBase(firma);
  for (;;) {
    const slug = `${base}-${zufallsSuffix()}`;
    if (!exists(slug)) return slug;
  }
}
