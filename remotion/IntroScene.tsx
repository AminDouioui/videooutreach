import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { Logo, SCHRIFT, firmaSchriftgroesse } from './Brand';
import { begruessung, INTRO_FRAMES, MARKE, UEBERBLENDUNG_FRAMES, type OutreachProps } from './schema';

const weich = Easing.bezier(0.16, 1, 0.3, 1);

/** Einblenden mit leichter Aufwärtsbewegung */
function einblenden(frame: number, start: number, dauer = 22) {
  const t = interpolate(frame, [start, start + dauer], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: weich });
  return { opacity: t, transform: `translateY(${(1 - t) * 28}px)` } as const;
}

/** Intro-Szene (5 s, endet auf reinem Weiß) – gemeinsam für OutreachIntro (Worker) und OutreachVideo (Studio-Vorschau). */
export const IntroScene: React.FC<OutreachProps> = ({ firma, vorname, nachname }) => {
  const frame = useCurrentFrame();
  const firmaGroesse = firmaSchriftgroesse(firma, 96, 1040);
  const balken = interpolate(frame, [30, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: weich });
  // Ausblenden nach Weiß; der letzte Frame (149) ist vollständig weiß, der Teaser startet ebenfalls auf Weiß
  const aus = interpolate(frame, [INTRO_FRAMES - 1 - UEBERBLENDUNG_FRAMES, INTRO_FRAMES - 1], [1, 0], { extrapolateLeft: 'clamp' });

  return (
    // Äußere Ebene bleibt immer weiß, sonst würde die Ausblendung nach Schwarz (transparent) statt nach Weiß laufen
    <AbsoluteFill style={{ background: MARKE.hintergrund }}>
      <AbsoluteFill style={{ fontFamily: SCHRIFT, opacity: aus }}>
        <AbsoluteFill style={{ padding: '0 120px', justifyContent: 'center' }}>
          <div style={{ ...einblenden(frame, 8), fontSize: 44, fontWeight: 600, color: MARKE.text, marginBottom: 22 }}>
            {begruessung({ vorname, nachname })},
          </div>
          <div style={{ ...einblenden(frame, 28), fontSize: 40, fontWeight: 400, color: MARKE.grau, marginBottom: 6 }}>ein Video für</div>
          <div
            style={{
              ...einblenden(frame, 38),
              fontSize: firmaGroesse,
              fontWeight: 800,
              letterSpacing: -firmaGroesse * 0.025,
              lineHeight: 1.08,
              color: MARKE.akzent,
              maxWidth: 1040,
              overflowWrap: 'anywhere',
            }}
          >
            {firma}
          </div>
          <div style={{ marginTop: 34, height: 6, width: 120 * balken, borderRadius: 3, background: MARKE.akzent }} />
        </AbsoluteFill>
        <Logo style={{ position: 'absolute', right: 64, bottom: 52, ...einblenden(frame, 60) }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
