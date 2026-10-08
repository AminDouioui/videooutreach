import React from 'react';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-800.css';
import { MARKE } from './schema';

export const SCHRIFT = "'Inter', system-ui, sans-serif";

/** Logo-Schriftzug „Prozessia.“ mit Unterzeile „AI AGENCY“ */
export const Logo: React.FC<{ groesse?: number; style?: React.CSSProperties }> = ({ groesse = 34, style }) => (
  <div style={{ fontFamily: SCHRIFT, lineHeight: 1, textAlign: 'right', ...style }}>
    <div style={{ fontWeight: 800, fontSize: groesse, letterSpacing: -groesse * 0.03, color: MARKE.text }}>
      Prozessia<span style={{ color: MARKE.akzent }}>.</span>
    </div>
    <div style={{ fontWeight: 600, fontSize: groesse * 0.3, letterSpacing: groesse * 0.12, color: MARKE.grau, marginTop: groesse * 0.2 }}>
      AI AGENCY
    </div>
  </div>
);

/** Runder Play-Button (lila Kreis, weißes Dreieck, dezenter Schatten) */
export const PlayButton: React.FC<{ groesse: number }> = ({ groesse }) => (
  <div
    style={{
      width: groesse,
      height: groesse,
      borderRadius: '50%',
      background: MARKE.akzent,
      boxShadow: '0 18px 40px rgba(123,58,236,0.35)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width={groesse * 0.4} height={groesse * 0.4} viewBox="0 0 10 10" style={{ marginLeft: groesse * 0.04 }}>
      <path d="M1.5 0.5 L9 5 L1.5 9.5 Z" fill="#fff" strokeLinejoin="round" stroke="#fff" strokeWidth="0.6" />
    </svg>
  </div>
);

/** Schriftgröße je nach Firmenlänge, damit der Name nie abgeschnitten wird */
export function firmaSchriftgroesse(firma: string, max: number, breite: number): number {
  const pro = max * 0.58; // grobe mittlere Zeichenbreite bei Inter 800
  const zeilen = firma.length * pro > breite ? 2 : 1;
  const laengsteZeile = zeilen === 1 ? firma.length : Math.ceil(firma.length / 2);
  return Math.max(36, Math.min(max, Math.floor(breite / (laengsteZeile * 0.6))));
}
