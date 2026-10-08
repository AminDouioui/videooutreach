import React from 'react';
import { Composition, Still } from 'remotion';
import { getVideoMetadata } from '@remotion/media-utils';
import { staticFile } from 'remotion';
import { OutreachThumbnail } from './OutreachThumbnail';
import { OutreachVideo } from './OutreachVideo';
import {
  BREITE,
  FPS,
  HOEHE,
  INTRO_FRAMES,
  outreachPropsSchema,
  standardProps,
  TEASER_DATEI,
  TEASER_FRAMES_FALLBACK,
  UEBERBLENDUNG_FRAMES,
} from './schema';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="OutreachVideo"
      component={OutreachVideo}
      width={BREITE}
      height={HOEHE}
      fps={FPS}
      durationInFrames={INTRO_FRAMES + TEASER_FRAMES_FALLBACK}
      schema={outreachPropsSchema}
      defaultProps={{ ...standardProps, teaserFrames: TEASER_FRAMES_FALLBACK, teaserDatei: TEASER_DATEI }}
      // Gesamtlänge aus dem tatsächlichen Teaser ableiten (Datei ist austauschbar)
      calculateMetadata={async ({ props }) => {
        let teaserFrames = TEASER_FRAMES_FALLBACK;
        try {
          const meta = await getVideoMetadata(staticFile(props.teaserDatei));
          teaserFrames = Math.round(meta.durationInSeconds * FPS);
        } catch {
          // Fallback auf feste Länge
        }
        return {
          durationInFrames: INTRO_FRAMES - UEBERBLENDUNG_FRAMES + teaserFrames,
          props: { ...props, teaserFrames },
        };
      }}
    />
    <Still id="OutreachThumbnail" component={OutreachThumbnail} width={BREITE} height={HOEHE} schema={outreachPropsSchema} defaultProps={standardProps} />
  </>
);
