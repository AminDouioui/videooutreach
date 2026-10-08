import React from 'react';
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { IntroScene } from './IntroScene';
import { INTRO_FRAMES, MARKE, UEBERBLENDUNG_FRAMES, type OutreachProps } from './schema';

/** Nur für die Studio-Vorschau (Intro + Teaser). Der Worker rendert OutreachIntro und hängt den vorkodierten Teaser per ffmpeg an. */
export const OutreachVideo: React.FC<OutreachProps & { teaserFrames: number; teaserDatei: string }> = ({ teaserFrames, teaserDatei, ...props }) => {
  const frame = useCurrentFrame();
  const teaserStart = INTRO_FRAMES - UEBERBLENDUNG_FRAMES;
  const einblendung = interpolate(frame, [teaserStart, INTRO_FRAMES], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: MARKE.hintergrund }}>
      <Sequence from={0} durationInFrames={INTRO_FRAMES} premountFor={0}>
        <IntroScene {...props} />
      </Sequence>
      <Sequence from={teaserStart} durationInFrames={teaserFrames} style={{ opacity: einblendung }}>
        <OffthreadVideo src={staticFile(teaserDatei)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </Sequence>
    </AbsoluteFill>
  );
};
