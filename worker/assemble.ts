import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getEnv } from '../lib/env';
import { BREITE, FPS, HOEHE, INTRO_FRAMES } from '../remotion/schema';

// Video-Assembly: Der Teaser wird einmal vorkodiert (Cache), pro Lead wird nur das Intro gerendert
// und per ffmpeg (Stream-Copy) mit dem Teaser verkettet.

/** Länge des Weiß-Einblendens am Teaser-Anfang (Sekunden) – sorgt für nahtlosen Übergang nach dem Intro. */
const TEASER_EINBLENDEN_S = 0.25;
/** Erlaubte Abweichung der Gesamtdauer vom Soll (Sekunden) */
const DAUER_TOLERANZ_S = 0.3;

/** Ruft ffmpeg (Pfad aus FFMPEG_PATH) ohne Shell auf. Rückgabe: stderr (enthält bei -f null die Statistik). */
export function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getEnv().FFMPEG_PATH, ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-8000);
    });
    proc.on('error', (e) => reject(new Error(`ffmpeg konnte nicht gestartet werden (${getEnv().FFMPEG_PATH}): ${e.message}`)));
    proc.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg Exit-Code ${code}: ${err.slice(-1500)}`))));
  });
}

/** Cache-Verzeichnis `${DATA_DIR}/cache`. */
export function cacheDir(): string {
  return path.join(path.resolve(getEnv().DATA_DIR), 'cache');
}

/** Hash über Dateigröße + mtime des Teasers (günstig, ändert sich beim Ersetzen der Datei). */
export function teaserHash(teaserFile: string): string {
  const st = fs.statSync(teaserFile);
  return crypto.createHash('sha1').update(`${st.size}:${Math.floor(st.mtimeMs)}`).digest('hex').slice(0, 12);
}

/**
 * Parameter, die Intro (Remotion) und Teaser (ffmpeg) gemeinsam haben müssen, damit Stream-Copy-Concat funktioniert.
 * Intro: Remotion h264/crf 28, AAC 48 kHz Stereo (enforceAudioTrack).
 */
// Remotion liefert yuvj420p (Full Range, bt470bg) mit Timebase 1/90000 – der Teaser wird exakt so kodiert.
const GEMEINSAM_VIDEO = [
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuvj420p', '-crf', '28', '-preset', 'medium',
  '-r', String(FPS), '-fps_mode', 'cfr',
  '-color_range', 'pc', '-colorspace', 'bt470bg',
  '-video_track_timescale', '90000',
];
const GEMEINSAM_AUDIO = ['-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k'];

/** Pfad der Audio-Spur im Cache: 5 s Stille (Intro) + Teaser-Ton, AAC 48 kHz Stereo. */
function audioCachePfad(videoCache: string): string {
  return videoCache.replace(/\.mp4$/, '.audio.m4a');
}

/**
 * Kodiert den Teaser passend zum Intro vor (Video + Ton) und baut dazu die komplette Audio-Spur
 * (Stille für das Intro + Teaser-Ton). Vorhandener Cache-Eintrag wird wiederverwendet.
 * Die Audio-Spur wird einmalig gebaut, damit am Übergang kein AAC-Priming-/Padding-Versatz entsteht.
 */
export async function ensureTeaserCache(teaserFile: string): Promise<string> {
  const hash = teaserHash(teaserFile);
  const ziel = path.join(cacheDir(), `teaser-${hash}.mp4`);
  const audioZiel = audioCachePfad(ziel);
  if (fs.existsSync(ziel) && fs.existsSync(audioZiel)) return ziel;
  fs.mkdirSync(cacheDir(), { recursive: true });
  const tmp = `${ziel}.${process.pid}.tmp.mp4`;
  const tmpAudio = `${audioZiel}.${process.pid}.tmp.m4a`;
  console.log(`[render] Kodiere Teaser vor (einmalig, Cache ${path.basename(ziel)}) …`);
  const t = Date.now();
  const filter =
    `scale=w=${BREITE}:h=${HOEHE}:force_original_aspect_ratio=decrease:flags=lanczos:out_range=pc,` +
    `pad=${BREITE}:${HOEHE}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=${FPS},format=yuvj420p,` +
    `fade=t=in:st=0:d=${TEASER_EINBLENDEN_S}:color=white`;
  const introSekunden = INTRO_FRAMES / FPS;
  try {
    await ffmpeg(['-i', teaserFile, '-vf', filter, ...GEMEINSAM_VIDEO, ...GEMEINSAM_AUDIO, '-movflags', '+faststart', tmp]);
    await ffmpeg([
      '-f', 'lavfi', '-t', String(introSekunden), '-i', 'anullsrc=r=48000:cl=stereo',
      '-i', teaserFile,
      '-filter_complex', '[1:a:0]aresample=48000,aformat=channel_layouts=stereo[a1];[0:a][a1]concat=n=2:v=0:a=1[a]',
      '-map', '[a]', ...GEMEINSAM_AUDIO,
      tmpAudio,
    ]);
    fs.renameSync(tmpAudio, audioZiel);
    fs.renameSync(tmp, ziel);
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(tmpAudio, { force: true });
  }
  // Alte Cache-Einträge (anderer Hash) aufräumen
  for (const f of fs.readdirSync(cacheDir())) {
    if (/^teaser-[0-9a-f]+\.(mp4|audio\.m4a)$/.test(f) && !f.startsWith(`teaser-${hash}.`)) fs.rmSync(path.join(cacheDir(), f), { force: true });
  }
  console.log(`[render] Teaser-Cache fertig (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  return ziel;
}

/** Container-Dauer (Sekunden) laut ffmpeg-Header, ohne ffprobe. */
async function containerDauer(datei: string): Promise<number> {
  const log = await ffmpeg(['-i', datei, '-c', 'copy', '-f', 'null', '-']);
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(log);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

/**
 * Intro-Video + Teaser-Cache verketten (Stream-Copy, Concat-Demuxer). Ton: vorgebaute Spur aus dem Cache.
 * Bei auffälliger Gesamtdauer oder Fehlern: Fallback mit Re-Encode über den concat-Filter.
 */
export async function concatIntroTeaser(introFile: string, teaserCacheFile: string, ausgabe: string): Promise<void> {
  const liste = `${ausgabe}.list.txt`;
  const audio = audioCachePfad(teaserCacheFile);
  const esc = (p: string) => path.resolve(p).replace(/'/g, `'\\''`);
  fs.writeFileSync(liste, `file '${esc(introFile)}'\nfile '${esc(teaserCacheFile)}'\n`);
  try {
    await ffmpeg([
      '-f', 'concat', '-safe', '0', '-i', liste, '-i', audio,
      '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', ausgabe,
    ]);
    const soll = INTRO_FRAMES / FPS + (await containerDauer(teaserCacheFile));
    const ist = await containerDauer(ausgabe);
    if (!Number.isFinite(ist) || Math.abs(ist - soll) > DAUER_TOLERANZ_S) throw new Error(`Dauer ${ist} s statt ${soll.toFixed(2)} s`);
  } catch (e) {
    console.warn(`[render] Stream-Copy-Concat nicht sauber (${e instanceof Error ? e.message.slice(0, 200) : e}) – Fallback mit Re-Encode`);
    await ffmpeg([
      '-i', introFile, '-i', teaserCacheFile, '-i', audio,
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-map', '2:a:0',
      ...GEMEINSAM_VIDEO, '-c:a', 'copy',
      '-movflags', '+faststart',
      ausgabe,
    ]);
  } finally {
    fs.rmSync(liste, { force: true });
  }
}
