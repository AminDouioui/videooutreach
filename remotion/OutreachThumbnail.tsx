import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Logo, PlayButton, SCHRIFT, firmaSchriftgroesse } from './Brand';
import { MARKE, type OutreachProps } from './schema';

/** Vorschaubild: wirkt wie ein Video-Frame mit Play-Button. */
export const OutreachThumbnail: React.FC<OutreachProps> = ({ firma }) => {
  const groesse = firmaSchriftgroesse(firma, 84, 700);
  return (
    <AbsoluteFill style={{ background: MARKE.hintergrund, fontFamily: SCHRIFT }}>
      {/* dezenter lila Verlauf rechts wie bei einem Video-Frame */}
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 78% 50%, rgba(123,58,236,0.13), rgba(123,58,236,0) 55%)' }} />
      <div style={{ position: 'absolute', left: 90, top: 0, bottom: 0, width: 720, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontSize: 38, fontWeight: 400, color: MARKE.grau, marginBottom: 10 }}>Ein Video für</div>
        <div style={{ fontSize: groesse, fontWeight: 800, color: MARKE.akzent, lineHeight: 1.08, letterSpacing: -groesse * 0.025, overflowWrap: 'anywhere' }}>
          {firma}
        </div>
        <div style={{ marginTop: 34, display: 'inline-flex', alignSelf: 'flex-start', padding: '12px 26px', borderRadius: 999, background: MARKE.akzent, color: '#fff', fontSize: 24, fontWeight: 600 }}>
          Ihr persönliches Video · ca. 1 Minute
        </div>
      </div>
      <div style={{ position: 'absolute', right: 130, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
        <PlayButton groesse={230} />
      </div>
      <Logo groesse={30} style={{ position: 'absolute', left: 90, bottom: 48, textAlign: 'left' }} />
    </AbsoluteFill>
  );
};
