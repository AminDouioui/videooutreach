import { describe, expect, it } from 'vitest';
import { LEAD_STATUS as SCHEMA_STATUS } from '@/db/schema';
import { emailDomain, firmenDomain, FLOW_ENDENDE_STATUS, gmailThreadUrl, istFreemail, LEAD_STATUS, LEAD_STATUS_INFO, statusBeendetFlow, statusPatch } from './lead-status';

const jetzt = new Date('2026-07-15T09:00:00Z');

describe('Lead-Status', () => {
  it('stimmt mit dem Schema überein und hat zu jedem Status Label und Farbe', () => {
    expect([...LEAD_STATUS]).toEqual([...SCHEMA_STATUS]);
    for (const s of LEAD_STATUS) expect(LEAD_STATUS_INFO[s].label).toBeTruthy();
  });

  it('beendet den Flow bei nicht_interessiert, falscher_ansprechpartner, gewonnen, verloren, termin_gebucht', () => {
    expect([...FLOW_ENDENDE_STATUS].sort()).toEqual(['falscher_ansprechpartner', 'gewonnen', 'nicht_interessiert', 'termin_gebucht', 'verloren']);
    for (const s of ['offen', 'interessiert', 'spaeter']) expect(statusBeendetFlow(s)).toBe(false);
    expect(statusBeendetFlow('unbekannt')).toBe(false);
  });

  it('stoppt den Flow und überspringt eine noch nicht gesendete Erstmail', () => {
    expect(statusPatch({ flowStopp: null, sendStatus: 'gesendet', sendError: null }, 'nicht_interessiert', jetzt)).toEqual({ flowStopp: 'status', flowStoppAt: jetzt });
    expect(statusPatch({ flowStopp: null, sendStatus: 'geplant', sendError: null }, 'verloren', jetzt)).toEqual({
      flowStopp: 'status',
      flowStoppAt: jetzt,
      sendStatus: 'uebersprungen',
      sendError: 'Lead-Status: Verloren',
    });
  });

  it('überschreibt einen Stopp aus anderem Grund nicht', () => {
    const p = statusPatch({ flowStopp: 'beantwortet', sendStatus: 'gesendet', sendError: null }, 'gewonnen', jetzt);
    expect(p).toEqual({});
  });

  it('Status zurück auf offen hebt nur den durch den Status gesetzten Stopp auf', () => {
    expect(statusPatch({ flowStopp: 'status', sendStatus: 'gesendet', sendError: null }, 'offen', jetzt)).toEqual({ flowStopp: null, flowStoppAt: null });
    for (const grund of ['beantwortet', 'bounce', 'abgemeldet', 'firma_beantwortet']) {
      expect(statusPatch({ flowStopp: grund, sendStatus: 'gesendet', sendError: null }, 'offen', jetzt)).toEqual({});
    }
    // Status-Übersprung wird zurückgenommen, anderer Übersprung nicht
    expect(statusPatch({ flowStopp: 'status', sendStatus: 'uebersprungen', sendError: 'Lead-Status: Gewonnen' }, 'interessiert', jetzt)).toMatchObject({ sendStatus: 'nicht_gesendet', sendError: null });
    expect(statusPatch({ flowStopp: null, sendStatus: 'uebersprungen', sendError: 'Abgemeldet' }, 'offen', jetzt)).toEqual({});
  });

  it('wechselt zwischen zwei beendenden Status ohne den Stopp zu verlieren', () => {
    expect(statusPatch({ flowStopp: 'status', sendStatus: 'gesendet', sendError: null }, 'verloren', jetzt)).toEqual({});
  });
});

describe('Firmen-Domain', () => {
  it('liest die Domain klein und robust', () => {
    expect(emailDomain(' Max@Firma.DE ')).toBe('firma.de');
    expect(emailDomain('kein-at')).toBeNull();
    expect(emailDomain('@firma.de')).toBeNull();
    expect(emailDomain('max@')).toBeNull();
  });

  it('nimmt Freemail-Domains aus', () => {
    for (const d of ['gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'freenet.de', 'posteo.de', 'mail.de']) {
      expect(istFreemail(d)).toBe(true);
      expect(firmenDomain(`x@${d.toUpperCase()}`)).toBeNull();
    }
    expect(firmenDomain('x@mueller-bau.de')).toBe('mueller-bau.de');
  });

  it('baut den Gmail-Link', () => {
    expect(gmailThreadUrl('18c3abc')).toBe('https://mail.google.com/mail/u/0/#all/18c3abc');
  });
});
