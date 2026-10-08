import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import { Logo, SCHRIFT, firmaSchriftgroesse } from './Brand';
import { begruessung, INTRO_FRAMES, MARKE, UEBERBLENDUNG_FRAMES, type OutreachProps } from './schema';

const weich = Easing.bezier(0.16, 1, 0.3, 1);

/** Einblenden mit leichter Aufwärtsbewegung */
function einblenden(frame: number, start: number, dauer = 22) {
  const t = interpolate(frame, [start, start + dauer], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: weich });
  return { opacity: t, transform: `translateY(${(1 - t) * 28}px)` } as const;
}

const Intro: React.FC<OutreachProps> = ({ firma, vorname, nachname }) => {
  const frame = useCurrentFrame();
  const firmaGroesse = firmaSchriftgroesse(firma, 96, 1040);
  const balken = interpolate(frame, [30, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: weich });
  // sanftes Ausblenden am Ende des Intros
  const aus = interpolate(frame, [INTRO_FRAMES - UEBERBLENDUNG_FRAMES, INTRO_FRAMES], [1, 0], { extrapolateLeft: 'clamp' });

  return (
    <AbsoluteFill style={{ background: MARKE.hintergrund, fontFamily: SCHRIFT, opacity: aus }}>
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
  );
};

/** Personalisiertes Intro (5 s) + Teaser des Auftraggebers (skaliert auf 1280x720, mit Ton). */
export const OutreachVideo: React.FC<OutreachProps & { teaserFrames: number; teaserDatei: string }> = ({ teaserFrames, teaserDatei, ...props }) => {
  const frame = useCurrentFrame();
  const teaserStart = INTRO_FRAMES - UEBERBLENDUNG_FRAMES;
  const einblendung = interpolate(frame, [teaserStart, INTRO_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: MARKE.hintergrund }}>
      <Sequence from={0} durationInFrames={INTRO_FRAMES} premountFor={0}>
        <Intro {...props} />
      </Sequence>
      <Sequence from={teaserStart} durationInFrames={teaserFrames} style={{ opacity: einblendung }}>
        <OffthreadVideo src={staticFile(teaserDatei)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </Sequence>
    </AbsoluteFill>
  );
};
