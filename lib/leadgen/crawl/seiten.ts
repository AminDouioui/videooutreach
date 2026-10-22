import * as cheerio from 'cheerio';

// Welche Unterseiten einer Firmenwebseite lohnen den Abruf? Impressum, Kontakt, Team/Über uns, Management.

export type SeitenArt = 'start' | 'impressum' | 'kontakt' | 'team' | 'sonstige';
export type SeitenZiel = { url: string; art: Exclude<SeitenArt, 'start' | 'sonstige'> };

const MUSTER: Array<[SeitenZiel['art'], RegExp]> = [
  ['impressum', /impressum|imprint|legal[-_ ]?notice|anbieterkennzeichnung/i],
  ['kontakt', /kontakt|contact|anfahrt/i],
  ['team', /team|ueber[-_ ]?uns|über[-_ ]?uns|about|unternehmen|company|gesch(?:ä|ae)ftsf(?:ü|ue)hr|management|ansprechpartner|mitarbeiter|f(?:ü|ue)hrung|leitung|wir[-_ ]?sind/i],
];

/** Pfade, die ohne Hinweis auf der Startseite probiert werden */
export const STANDARD_PFADE: Array<[SeitenZiel['art'], string]> = [
  ['impressum', '/impressum'],
  ['kontakt', '/kontakt'],
];

const ENDUNG_AUSSCHLUSS = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)/i;

/** Gleiche Domain (mit oder ohne „www.“) */
export function gleicheSeite(a: string, b: string): boolean {
  try {
    const h = (u: string) => new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    return h(a) === h(b);
  } catch {
    return false;
  }
}

/**
 * Wählt aus den Links der Startseite die relevanten Unterseiten (nur dieselbe Domain), je Art höchstens `proArt`, insgesamt `max`.
 * Reihenfolge: Impressum, Kontakt, Team. Ohne Treffer wird auf die Standardpfade zurückgegriffen.
 */
export function waehleSeiten(html: string, basisUrl: string, opt: { proArt?: number; max?: number } = {}): SeitenZiel[] {
  const proArt = opt.proArt ?? 2;
  const max = opt.max ?? 6;
  const $ = cheerio.load(html);
  const gefunden: Record<SeitenZiel['art'], string[]> = { impressum: [], kontakt: [], team: [] };
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
    let url: URL;
    try {
      url = new URL(href, basisUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || !gleicheSeite(url.toString(), basisUrl) || ENDUNG_AUSSCHLUSS.test(url.pathname)) return;
    url.hash = '';
    const text = `${decodeURIComponent(url.pathname)} ${$(el).text()}`.slice(0, 200);
    for (const [art, muster] of MUSTER) {
      if (!muster.test(text)) continue;
      const s = url.toString();
      if (!gefunden[art].includes(s) && gefunden[art].length < proArt) gefunden[art].push(s);
      break;
    }
  });
  const ziele: SeitenZiel[] = [];
  for (const art of ['impressum', 'kontakt', 'team'] as const) for (const url of gefunden[art]) ziele.push({ url, art });
  for (const [art, pfad] of STANDARD_PFADE) {
    if (!gefunden[art].length) ziele.push({ url: new URL(pfad, basisUrl).toString(), art });
  }
  return ziele.slice(0, max);
}

/** Sichtbarer Text einer Seite (ohne Skripte und Navigation), Zeilenumbrüche an Blockgrenzen. */
export function seitenText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, template').remove();
  // E-Mail-Adressen aus mailto-Links und Telefonnummern aus tel-Links sichtbar machen (stehen oft nicht im Linktext)
  $('a[href^="mailto:" i]').each((_, el) => {
    const m = ($(el).attr('href') ?? '').replace(/^mailto:/i, '').split('?')[0].trim();
    if (m && !$(el).text().includes('@')) $(el).append(` ${m} `);
  });
  $('a[href^="tel:" i]').each((_, el) => {
    const t = decodeURIComponent(($(el).attr('href') ?? '').replace(/^tel:/i, '')).trim();
    if (t && !$(el).text().replace(/\D/g, '').includes(t.replace(/\D/g, '').slice(-6))) $(el).append(` ${t} `);
  });
  $('br').replaceWith('\n');
  $('p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, address, footer, header').each((_, el) => {
    $(el).append('\n');
  });
  return $('body')
    .text()
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
