import React from 'react';
import { IntroScene } from './IntroScene';
import type { OutreachProps } from './schema';

/** Nur das personalisierte Intro (150 Frames) – wird vom Worker gerendert, der Teaser kommt vorkodiert aus dem Cache. */
export const OutreachIntro: React.FC<OutreachProps> = (props) => <IntroScene {...props} />;
