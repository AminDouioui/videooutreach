import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame } from 'remotion';
import { Logo, SCHRIFT, firmaSchriftgroesse } from './Brand';
import { begruessung, INTRO_FRAMES, MARKE, UEBERBLENDUNG_FRAMES, type OutreachProps } from './schema';

const weich = Easing.bezier(0.16, 1, 0.3, 1);

/** Einblenden mit leichter Aufwärtsbewegung */
function einblenden(frame: number, start: number, dauer = 22) {
  const t = interpolate(frame, [start, start + dauer], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: weich });
  return { opacity: t, transform: `translateY(${(1 - t) * 28}px)` } as const;
}

/** Intro-Szene (5 s, endet auf reinem Weiß) – gemeinsam für OutreachIntro (Worker) und OutreachVideo (Studio-Vorschau). */
/** Browser-Fenster mit dem Screenshot der Kundenwebsite, schiebt von rechts ein und zoomt langsam */
const WebsiteFenster: React.FC<{ bild: string; host?: string; frame: number }> = ({ bild, host, frame }) => {
  const t = interpolate(frame, [34, 64], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: weich });
  const zoom = interpolate(frame, [34, INTRO_FRAMES], [1, 1.06], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const breite = 470;
  const inhaltHoehe = Math.round((breite * 9) / 16);
  return (
    <div
      style={{
        position: 'absolute',
        left: 730,
        top: 200,
        width: breite,
        opacity: t,
        transform: `translateX(${(1 - t) * 90}px)`,
        borderRadius: 14,
        overflow: 'hidden',
        background: '#fff',
        border: '1px solid #e4e4ea',
        boxShadow: '0 30px 70px -20px rgba(10,10,10,0.35)',
      }}
    >
      <div style={{ height: 34, background: '#f3f3f6', display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', borderBottom: '1px solid #e4e4ea' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 10, height: 10, borderRadius: 5, background: c }} />
        ))}
        {host && (
          <span style={{ marginLeft: 10, flex: 1, height: 20, borderRadius: 10, background: '#fff', border: '1px solid #e4e4ea', fontSize: 12, lineHeight: '18px', color: MARKE.grau, padding: '0 10px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {host}
          </span>
        )}
      </div>
      <div style={{ width: breite, height: inhaltHoehe, overflow: 'hidden' }}>
        <Img src={bild} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', transform: `scale(${zoom})`, transformOrigin: 'top center' }} />
      </div>
    </div>
  );
};

export const IntroScene: React.FC<OutreachProps> = ({ firma, vorname, nachname, logoUrl, websiteScreenshotUrl, websiteHost }) => {
  const frame = useCurrentFrame();
  // Mit Website-Screenshot rückt der Text nach links und wird etwas kleiner, rechts steht das Browser-Fenster
  const mitFenster = !!websiteScreenshotUrl;
  const textBreite = mitFenster ? 560 : 1040;
  const firmaGroesse = firmaSchriftgroesse(firma, mitFenster ? 80 : 96, textBreite);
  const balken = interpolate(frame, [30, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: weich });
  // Ausblenden nach Weiß; der letzte Frame (149) ist vollständig weiß, der Teaser startet ebenfalls auf Weiß
  const aus = interpolate(frame, [INTRO_FRAMES - 1 - UEBERBLENDUNG_FRAMES, INTRO_FRAMES - 1], [1, 0], { extrapolateLeft: 'clamp' });

  return (
    // Äußere Ebene bleibt immer weiß, sonst würde die Ausblendung nach Schwarz (transparent) statt nach Weiß laufen
    <AbsoluteFill style={{ background: MARKE.hintergrund }}>
      <AbsoluteFill style={{ fontFamily: SCHRIFT, opacity: aus }}>
        <AbsoluteFill style={{ padding: '0 120px', justifyContent: 'center' }}>
          <div style={{ ...einblenden(frame, 8), fontSize: mitFenster ? 36 : 44, fontWeight: 600, color: MARKE.text, marginBottom: 22 }}>
            {begruessung({ vorname, nachname })},
          </div>
          <div style={{ ...einblenden(frame, 28), fontSize: mitFenster ? 34 : 40, fontWeight: 400, color: MARKE.grau, marginBottom: 6 }}>ein Video für</div>
          <div
            style={{
              ...einblenden(frame, 38),
              fontSize: firmaGroesse,
              fontWeight: 800,
              letterSpacing: -firmaGroesse * 0.025,
              lineHeight: 1.08,
              color: MARKE.akzent,
              maxWidth: textBreite,
              overflowWrap: 'anywhere',
            }}
          >
            {firma}
          </div>
          <div style={{ marginTop: 34, height: 6, width: 120 * balken, borderRadius: 3, background: MARKE.akzent }} />
        </AbsoluteFill>
        {websiteScreenshotUrl && <WebsiteFenster bild={websiteScreenshotUrl} host={websiteHost} frame={frame} />}
        {logoUrl && (
          // Logo der angeschriebenen Firma (aus der Importspalte logo), oben links, weich eingeblendet
          <div style={{ position: 'absolute', left: 120, top: 64, maxWidth: 300, height: 84, display: 'flex', alignItems: 'center', ...einblenden(frame, 44) }}>
            <Img src={logoUrl} style={{ maxWidth: 300, maxHeight: 84, objectFit: 'contain' }} />
          </div>
        )}
        <Logo style={{ position: 'absolute', right: 64, bottom: 52, ...einblenden(frame, 60) }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
