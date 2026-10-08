'use client';

import { useCallback, useEffect, useRef } from 'react';

type Props = {
  slug: string;
  videoSrc: string;
  posterSrc: string;
  ctaUrl: string;
  mailto: string | null;
};

const SCHWELLEN = [
  { typ: 'progress_25', anteil: 0.25 },
  { typ: 'progress_50', anteil: 0.5 },
  { typ: 'progress_75', anteil: 0.75 },
] as const;

/** Sendet ein Tracking-Event; sendBeacon als text/plain (kein CORS-Preflight), Fallback fetch keepalive. */
function sende(slug: string, type: string) {
  const body = JSON.stringify({ slug, type });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/t', new Blob([body], { type: 'text/plain' }))) return;
  } catch {
    // weiter mit fetch
  }
  try {
    void fetch('/api/t', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } });
  } catch {
    // Tracking darf die Seite nie stören
  }
}

export function VideoPlayer({ slug, videoSrc, posterSrc, ctaUrl, mailto }: Props) {
  const gesendet = useRef(new Set<string>());

  const einmal = useCallback(
    (typ: string) => {
      if (gesendet.current.has(typ)) return;
      gesendet.current.add(typ);
      sende(slug, typ);
    },
    [slug],
  );

  // page_view genau einmal beim Mount (Ref schützt vor doppeltem Effekt im Dev-Modus)
  useEffect(() => {
    einmal('page_view');
  }, [einmal]);

  function zeitupdate(v: HTMLVideoElement) {
    if (!v.duration || !Number.isFinite(v.duration)) return;
    const anteil = v.currentTime / v.duration;
    for (const s of SCHWELLEN) if (anteil >= s.anteil) einmal(s.typ);
    if (anteil >= 0.99) einmal('progress_100');
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl bg-black shadow-[0_20px_60px_-20px_rgba(10,10,10,0.35)] ring-1 ring-black/5">
        <video
          controls
          playsInline
          preload="metadata"
          poster={posterSrc}
          src={videoSrc}
          className="block aspect-video w-full bg-black"
          onPlay={() => einmal('play')}
          onTimeUpdate={(e) => zeitupdate(e.currentTarget)}
          onEnded={() => einmal('progress_100')}
        >
          Ihr Browser unterstützt keine Videowiedergabe.
        </video>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <a
          href={ctaUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => sende(slug, 'cta_click')}
          className="inline-flex items-center justify-center rounded-full bg-[#7b3aec] px-7 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-[#6a2ed6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7b3aec] focus-visible:ring-offset-2"
        >
          15-Minuten-Termin buchen
        </a>
        {mailto && (
          <a
            href={mailto}
            className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-7 py-3.5 text-base font-semibold text-[#0a0a0a] transition hover:border-[#7b3aec] hover:text-[#7b3aec] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7b3aec] focus-visible:ring-offset-2"
          >
            Antworten
          </a>
        )}
      </div>
    </div>
  );
}
