import fs from 'fs';
import os from 'os';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from './env';
import { entwerfeAntwort, kiAktiv, KiFehler, kiFehlerAus, kuerzeMailtext, ordneAntwortEin, pruefeVorschlag, schlageVorlageVor, type KiAnfrage, type KiClient } from './ki';

Object.assign(process.env, {
  DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'vo-ki-')),
  ADMIN_PASSWORD: 'x',
  SESSION_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: '0'.repeat(64),
  IP_HASH_SALT: 's',
});
delete process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL_KLASSIFIZIEREN;
  delete process.env.ANTHROPIC_MODEL_SCHREIBEN;
  resetEnvCache();
});

/** Client, der die Anfragen merkt und nacheinander die Antworten liefert */
function fake(...antworten: (object | string | Error)[]) {
  const anfragen: KiAnfrage[] = [];
  const client: KiClient = async (a) => {
    anfragen.push(a);
    const x = antworten[Math.min(anfragen.length - 1, antworten.length - 1)];
    if (x instanceof Error) throw x;
    return typeof x === 'string' ? x : JSON.stringify(x);
  };
  return { anfragen, client };
}

describe('Konfiguration', () => {
  it('ohne Schlüssel inaktiv, mit Schlüssel aktiv; Standardmodelle laut Vorgabe, per Env überschreibbar', async () => {
    expect(kiAktiv()).toBe(false);
    const { anfragen, client } = fake({ kategorie: 'interessiert', konfidenz: 0.9, begruendung: 'x' });
    await ordneAntwortEin('Gern, rufen Sie an.', client);
    expect(anfragen[0].modell).toBe('claude-haiku-5-5');
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.ANTHROPIC_MODEL_KLASSIFIZIEREN = 'mein-haiku';
    resetEnvCache();
    expect(kiAktiv()).toBe(true);
    await ordneAntwortEin('Gern, rufen Sie an.', client);
    expect(anfragen[1].modell).toBe('mein-haiku');
  });
});

describe('Antworten einordnen', () => {
  it('strukturierte Ausgabe: Schema mit allen Kategorien, Konfidenz auf 0–1 begrenzt, Mailtext als Daten abgegrenzt', async () => {
    const { anfragen, client } = fake({ kategorie: 'spaeter', konfidenz: 1.4, begruendung: '  Im Herbst wieder melden.  ' });
    const e = await ordneAntwortEin('Bitte im Herbst nochmal melden.', client);
    expect(e).toEqual({ kategorie: 'spaeter', konfidenz: 1, begruendung: 'Im Herbst wieder melden.' });
    const a = anfragen[0];
    expect(a.nutzer).toBe('<mail>\nBitte im Herbst nochmal melden.\n</mail>');
    expect(JSON.stringify(a.schema)).toContain('falscher_ansprechpartner');
    expect(a.schema).toMatchObject({ additionalProperties: false, required: ['kategorie', 'konfidenz', 'begruendung'] });
  });
  it('sendet höchstens ~4000 Zeichen', async () => {
    const { anfragen, client } = fake({ kategorie: 'sonstiges', konfidenz: 0.5, begruendung: 'x' });
    await ordneAntwortEin('a'.repeat(9000), client);
    expect(anfragen[0].nutzer.length).toBeLessThan(4100);
  });
  it('unbekannte Kategorie oder kein JSON → verständlicher Fehler (wiederholbar), leerer Text ruft die KI nicht auf', async () => {
    await expect(ordneAntwortEin('Hallo', fake({ kategorie: 'termin_gebucht', konfidenz: 1, begruendung: 'x' }).client)).rejects.toMatchObject({ art: 'antwort', wiederholbar: true });
    await expect(ordneAntwortEin('Hallo', fake('Das ist kein JSON').client)).rejects.toBeInstanceOf(KiFehler);
    const leer = fake({});
    await expect(ordneAntwortEin('   \n ', leer.client)).rejects.toBeInstanceOf(KiFehler);
    expect(leer.anfragen).toHaveLength(0);
  });
  it('übersetzt API-Fehler ins Deutsche, ohne Mailinhalt', async () => {
    const h = new Headers();
    const fall = async (e: Error): Promise<KiFehler> => ordneAntwortEin('Geheimer Mailtext', fake(e).client).then(() => Promise.reject(new Error('kein Fehler')), (x: KiFehler) => x);
    const auth = await fall(Anthropic.APIError.generate(401, {}, 'invalid x-api-key', h));
    expect(auth).toMatchObject({ art: 'schluessel', wiederholbar: false });
    expect(auth.message).toContain('ungültig');
    const limit = await fall(Anthropic.APIError.generate(429, {}, 'rate', h));
    expect(limit).toMatchObject({ art: 'limit', wiederholbar: true });
    expect(limit.message).toContain('Rate-Limit');
    const ueberlast = await fall(Anthropic.APIError.generate(529, {}, 'overloaded', h));
    expect(ueberlast).toMatchObject({ art: 'ueberlast', wiederholbar: true });
    expect(ueberlast.message).toContain('überlastet');
    expect(kiFehlerAus(new Anthropic.APIConnectionTimeoutError()).art).toBe('zeit');
    expect(kiFehlerAus(new Anthropic.APIConnectionError({ message: 'fetch failed' })).art).toBe('verbindung');
    expect(kiFehlerAus(new Error('Geheimer Mailtext')).message).not.toContain('Geheim');
  });
  it('kuerzeMailtext zieht Leerzeilen zusammen', () => {
    expect(kuerzeMailtext('a  b\r\n\r\n\r\n\r\nc', 100)).toBe('a b\n\nc');
  });
});

describe('Schreibhilfe', () => {
  const gut = { betreff: 'Idee für {{firma}}', text: '{{begruessung}},\n\n{{vorschaubild}}\n\nkurz zu unserem Angebot.' };
  const wunsch = { beschreibung: 'Angebotsautomatisierung, Geschäftsführer, sachlich', art: 'erstmail' as const, mitVideo: true };

  it('gültiger Vorschlag wird zurückgegeben (Sonnet-Modell, Beschreibung als Daten abgegrenzt)', async () => {
    const { anfragen, client } = fake(gut);
    expect(await schlageVorlageVor(wunsch, client)).toEqual(gut);
    expect(anfragen).toHaveLength(1);
    expect(anfragen[0].modell).toBe('claude-sonnet-5-5');
    expect(anfragen[0].nutzer).toContain('<beschreibung>');
    expect(anfragen[0].system).toContain('{{vorschaubild}}');
  });
  it('Spintax ist erlaubt und wird im Prompt verlangt', async () => {
    const { anfragen, client } = fake({ betreff: '{Idee|Frage} für {{firma}}', text: '{Hallo|Guten Tag} {{firma}}, {{video_link}}' });
    const v = await schlageVorlageVor({ ...wunsch, spintax: true }, client);
    expect(v.text).toContain('{Hallo|Guten Tag}');
    expect(anfragen[0].system).toContain('Spintax-Varianten');
  });
  it('ungültiger Vorschlag (Klammern) → zweiter Versuch mit Hinweis; danach Fehler', async () => {
    const schlecht = { betreff: 'Idee {{firma}', text: '{{vorschaubild}} {Hallo|Moin' };
    const eins = fake(schlecht, gut);
    expect(await schlageVorlageVor(wunsch, eins.client)).toEqual(gut);
    expect(eins.anfragen).toHaveLength(2);
    expect(eins.anfragen[1].nutzer).toContain('unbrauchbar');
    const zwei = fake(schlecht);
    await expect(schlageVorlageVor(wunsch, zwei.client)).rejects.toMatchObject({ art: 'antwort' });
    expect(zwei.anfragen).toHaveLength(2);
  });
  it('Video-Platzhalter nur bei Video-Kampagne; unbekannte Platzhalter werden abgelehnt', () => {
    const textMitVideo = { betreff: 'x', text: 'Hallo {{vorschaubild}}' };
    expect(pruefeVorschlag(textMitVideo, { mitVideo: false, art: 'erstmail' }).join()).toContain('{{vorschaubild}}');
    expect(pruefeVorschlag({ betreff: 'x', text: 'Hallo {{firma}}' }, { mitVideo: false, art: 'erstmail' })).toEqual([]);
    expect(pruefeVorschlag({ betreff: 'x', text: 'Hallo {{firma}}' }, { mitVideo: true, art: 'erstmail' }).join()).toContain('weder {{vorschaubild}} noch {{video_link}}');
    expect(pruefeVorschlag({ betreff: 'x', text: 'Hallo {{firma}} {{erfunden}}' }, { mitVideo: false, art: 'followup' }).join()).toContain('{{erfunden}}');
    expect(pruefeVorschlag({ betreff: 'x', text: 'Hi {{stadt}}' }, { mitVideo: false, art: 'followup', extraSpalten: ['stadt'] })).toEqual([]);
  });
  it('Follow-up ohne eigenen Betreff: Betreff bleibt leer und ist erlaubt', async () => {
    const { client } = fake({ betreff: 'egal', text: '{{begruessung}}, kurz nachgehakt.' });
    expect(await schlageVorlageVor({ ...wunsch, art: 'followup', nr: 1, mitBetreff: false }, client)).toEqual({ betreff: '', text: '{{begruessung}}, kurz nachgehakt.' });
  });
  it('leere Beschreibung ruft die KI nicht auf', async () => {
    const { anfragen, client } = fake(gut);
    await expect(schlageVorlageVor({ ...wunsch, beschreibung: '  ' }, client)).rejects.toBeInstanceOf(KiFehler);
    expect(anfragen).toHaveLength(0);
  });
});

describe('Antwort-Entwurf', () => {
  it('nutzt Verlauf (letzte Nachrichten) und CTA-Link', async () => {
    const { anfragen, client } = fake({ text: ' Gern! Hier der Link: https://cal.example/x \n' });
    const text = await entwerfeAntwort(
      { ctaUrl: 'https://cal.example/x', absenderName: 'Amin', verlauf: [{ eigene: true, text: 'Unser Video.' }, { eigene: false, text: 'Klingt spannend, was kostet das?' }] },
      client,
    );
    expect(text).toBe('Gern! Hier der Link: https://cal.example/x');
    expect(anfragen[0].nutzer).toContain('<termin_link>https://cal.example/x</termin_link>');
    expect(anfragen[0].nutzer).toContain('[LEAD]\nKlingt spannend');
    expect(anfragen[0].nutzer).toContain('[WIR]\nUnser Video.');
  });
  it('ohne Nachricht des Leads kein Aufruf', async () => {
    const { anfragen, client } = fake({ text: 'x' });
    await expect(entwerfeAntwort({ ctaUrl: 'https://x.de', verlauf: [{ eigene: true, text: 'Hallo' }] }, client)).rejects.toBeInstanceOf(KiFehler);
    expect(anfragen).toHaveLength(0);
  });
});
