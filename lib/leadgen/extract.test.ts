import { describe, expect, it } from 'vitest';
import { normalisiereWz, wzZuBranche } from './extract/branche';
import { entschleiere, extrahiereEmails, extrahiereRegister, extrahiereTelefone, extrahiereUstId } from './extract/deterministic';
import { emailImText, groundingKontext, nameImText, rolleImText, telefonImText, zitatImText } from './extract/grounding';
import { gleicheSeite, seitenText, waehleSeiten } from './crawl/seiten';

describe('Deterministische Extraktion', () => {
  it('findet E-Mails, auch verschleiert, und lässt Platzhalter und Bilder weg', () => {
    const text = 'Mail: info@mueller-werkzeugbau.de, Vertrieb: h.meier (at) mueller-werkzeugbau [dot] de. Logo: banner@2x.png Beispiel: name@example.com';
    expect(extrahiereEmails(text).sort()).toEqual(['h.meier@mueller-werkzeugbau.de', 'info@mueller-werkzeugbau.de']);
    expect(entschleiere('a [at] b.de')).toBe('a@b.de');
  });

  it('findet Rufnummern und bestimmt die Art aus dem Umfeld', () => {
    const text = 'Telefon: 0711 1234567\nFax: 0711 1234568\nMobil: 0171 2345678\nDurchwahl: +49 711 1234-90';
    const t = extrahiereTelefone(text);
    const art = (e164: string) => t.find((x) => x.e164 === e164)?.art;
    expect(art('+49711123456' + '7')).toBe('zentrale');
    expect(art('+497111234568')).toBe('fax');
    expect(art('+491712345678')).toBe('mobil');
    expect(t.length).toBe(4);
  });

  it('liest USt-IdNr und Registerangaben', () => {
    expect(extrahiereUstId('USt-IdNr.: DE 123 456 789')).toBe('DE123456789');
    expect(extrahiereUstId('keine Angabe')).toBeNull();
    expect(extrahiereRegister('Registergericht: Amtsgericht Stuttgart\nHandelsregisternummer: HRB 100001')).toEqual({ art: 'HRB', nummer: '100001', gericht: 'Stuttgart' });
    expect(extrahiereRegister('Sitz Ulm, kein Eintrag')).toBeNull();
  });
});

describe('Grounding-Check', () => {
  const text = 'Geschäftsführer: Dr. Hans Müller\nLeiter Einkauf: Anna Schmidt-Meier\nKontakt: h.mueller@firma.de, Tel. 0711 1234567\nVertrieb: Meier, Peter';
  const ctx = groundingKontext(text);

  it('akzeptiert Namen, die im Text stehen (Titel, Umlaute, „Nachname, Vorname“)', () => {
    expect(nameImText(ctx, 'Hans', 'Müller')).toBe(true);
    expect(nameImText(ctx, 'Hans', 'Mueller')).toBe(true);
    expect(nameImText(ctx, 'Anna', 'Schmidt-Meier')).toBe(true);
    expect(nameImText(ctx, 'Peter', 'Meier')).toBe(true);
    expect(nameImText(ctx, null, 'Müller')).toBe(true);
  });
  it('verwirft erfundene Namen und falsche Kombinationen', () => {
    expect(nameImText(ctx, 'Thomas', 'Schneider')).toBe(false);
    // Nachname steht im Text, aber nicht mit diesem Vornamen
    expect(nameImText(ctx, 'Klaus', 'Müller')).toBe(false);
    expect(nameImText(ctx, 'Hans', 'Muell')).toBe(false);
  });
  it('akzeptiert Initial als Vorname', () => {
    expect(nameImText(groundingKontext('Ansprechpartner: H. Müller'), 'Hans', 'Müller')).toBe(true);
  });
  it('prüft E-Mail, Telefon, Rolle und Zitat gegen den Text', () => {
    // Groß-/Kleinschreibung ist bei E-Mail-Adressen unerheblich
    expect(emailImText(ctx, 'H.Mueller@firma.de')).toBe(true);
    expect(emailImText(ctx, 'hans.mueller@firma.de')).toBe(false);
    expect(emailImText(ctx, 'h.mueller@firma.de')).toBe(true);
    expect(emailImText(ctx, 'ceo@firma.de')).toBe(false);
    expect(telefonImText(ctx, '+49 711 1234567')).toBe(true);
    expect(telefonImText(ctx, '0711 9999999')).toBe(false);
    expect(rolleImText(ctx, 'Leiter Einkauf')).toBe(true);
    expect(rolleImText(ctx, 'Einkaufsleiter')).toBe(false);
    expect(zitatImText(ctx, 'Geschäftsführer: Dr. Hans Müller')).toBe(true);
    expect(zitatImText(ctx, 'wir bauen Raketen')).toBe(false);
    expect(zitatImText(ctx, 'kurz')).toBe(false);
  });
});

describe('Branche', () => {
  it('normalisiert WZ-Codes', () => {
    expect(normalisiereWz('25.73')).toBe('25.73');
    expect(normalisiereWz('2573')).toBe('25.73');
    expect(normalisiereWz('25.73.0')).toBe('25.73');
    expect(normalisiereWz('abc')).toBeNull();
  });
  it('ordnet WZ der Taxonomie zu', () => {
    expect(wzZuBranche('25.73')).toMatchObject({ branche: 'werkzeugbau' });
    expect(wzZuBranche('28.41')).toMatchObject({ branche: 'maschinenbau' });
    expect(wzZuBranche('25.62')).toMatchObject({ branche: 'sonstige_fertigung' });
    expect(wzZuBranche('47.11')).toMatchObject({ branche: 'keine_fertigung' });
    expect(wzZuBranche(null)).toBeNull();
  });
});

describe('Seitenwahl und Text', () => {
  const html = `<html><body><nav>
    <a href="/leistungen">Leistungen</a><a href="/impressum">Impressum</a><a href="/kontakt/">Kontakt</a>
    <a href="/unternehmen/team">Team</a><a href="https://fremd.de/impressum">Fremd</a><a href="/downloads/katalog.pdf">Impressum PDF</a>
    <a href="mailto:info@x.de">Mail</a></nav><p>Hallo<br>Welt</p><script>var x=1</script></body></html>`;
  it('wählt Impressum, Kontakt und Team derselben Domain', () => {
    const z = waehleSeiten(html, 'https://www.firma.de/');
    expect(z).toEqual([
      { url: 'https://www.firma.de/impressum', art: 'impressum' },
      { url: 'https://www.firma.de/kontakt/', art: 'kontakt' },
      { url: 'https://www.firma.de/unternehmen/team', art: 'team' },
    ]);
  });
  it('probiert Standardpfade, wenn die Startseite nichts verlinkt', () => {
    expect(waehleSeiten('<html><body>nix</body></html>', 'https://firma.de/').map((z) => z.url)).toEqual(['https://firma.de/impressum', 'https://firma.de/kontakt']);
  });
  it('erkennt dieselbe Domain mit und ohne www', () => {
    expect(gleicheSeite('https://www.a.de/x', 'https://a.de/')).toBe(true);
    expect(gleicheSeite('https://a.de', 'https://b.de')).toBe(false);
  });
  it('liefert sichtbaren Text, ohne Skripte, mit E-Mail aus mailto-Links', () => {
    const t = seitenText('<body><p>Kontakt</p><a href="mailto:vertrieb@firma.de">Schreiben Sie uns</a><script>alert(1)</script><div>Zeile 1<br>Zeile 2</div></body>');
    expect(t).toContain('vertrieb@firma.de');
    expect(t).toContain('Zeile 1\nZeile 2');
    expect(t).not.toContain('alert');
  });
});
