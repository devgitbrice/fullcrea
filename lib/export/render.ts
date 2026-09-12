"use client";

import { fetchFile } from '@ffmpeg/util';
import { getFFmpeg } from './ffmpeg';
import { renderTextOverlayPng } from './textOverlay';
import type { Clip, Track } from '@/lib/timeline/types';
import { buildVideoSegments, exportableAudioClips } from '@/lib/timeline/segments';

export type RenderProgress = (info: { stage: string; percent: number }) => void;

interface RenderOptions {
  clips: Clip[];
  tracks: Track[];
  pixelsPerSecond: number; // pour convertir start_px / width_px en secondes
  width: number;
  height: number;
  /** Largeur de composition du projet : sert à mettre le texte à l'échelle
   *  quand on exporte dans une résolution différente (défaut : `width`). */
  projectWidth?: number;
  fps?: number;
  onProgress?: RenderProgress;
}

// Convertit une URL en bytes pour ffmpeg.wasm
async function fetchBytes(url: string): Promise<Uint8Array> {
  return fetchFile(url);
}

// Échappe un nom de fichier pour le concat demuxer (single quotes).
function concatEscape(name: string): string {
  return name.replace(/'/g, "'\\''");
}

const fmt = (sec: number) => Math.max(0, sec).toFixed(3);

/**
 * Rend la timeline vidéo en MP4.
 *
 * Stratégie (balayage des points de montage, cf. lib/timeline/segments.ts) :
 *  1. La timeline est découpée aux starts/ends des clips visuels ; sur chaque
 *     intervalle, le clip de la piste du dessus gagne (couches respectées) et
 *     un trou donne un segment noir. Chaque segment est encodé en MP4 normalisé
 *     (résolution + fps cibles, H.264, audio AAC 44,1 kHz stéréo — toujours
 *     présent, silence compris, condition du concat `-c copy`).
 *  2. Concat des segments → video_only.mp4 (commence à t = 0, dure jusqu'à la
 *     fin du dernier clip visuel OU audio, pour que `adelay` reste absolu).
 *  3. Chaque clip audio (piste audio non muette, clip non muet) est extrait à
 *     son point d'entrée, avec volume puis délai absolu.
 *  4. Mux final : l'audio des vidéos est conservé et mixé avec les clips audio.
 *
 * Limitations restantes :
 *  - Pas de transformations (rotation/scale/position) — chaque clip est juste mis à l'échelle
 */
export async function renderProjectToMp4({
  clips,
  tracks,
  pixelsPerSecond,
  width,
  height,
  projectWidth,
  fps = 30,
  onProgress,
}: RenderOptions): Promise<Blob> {
  const ff = await getFFmpeg();

  const report = (stage: string, percent: number) => {
    onProgress?.({ stage, percent });
  };

  // 1) Segments vidéo (couches + trous) et clips audio exportables
  const segments = buildVideoSegments(clips, tracks, pixelsPerSecond, fps);
  const audioClips = exportableAudioClips(clips, tracks);

  if (segments.length === 0) {
    throw new Error('Aucun clip vidéo ou image à exporter.');
  }

  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps}`;
  const encodeArgs = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-ar', '44100', '-ac', '2'];

  // Une source utilisée par plusieurs segments (A/B/A) n'est écrite qu'une fois
  const inputBySrc = new Map<string, string>();
  const inputFor = async (clip: Clip): Promise<string> => {
    const cached = inputBySrc.get(clip.src);
    if (cached) return cached;
    const name = `vin_${inputBySrc.size}${clip.type === 'video' ? '.mp4' : '.img'}`;
    await ff.writeFile(name, await fetchBytes(clip.src));
    inputBySrc.set(clip.src, name);
    return name;
  };

  // Calque de texte : rendu en PNG transparent à la résolution de sortie, puis
  // composé sur l'image. Le texte garde ainsi exactement les proportions de
  // l'aperçu et du lecteur de partage.
  const textOverlayFor = async (seg: (typeof segments)[number], index: number): Promise<string | null> => {
    if (seg.texts.length === 0) return null;
    const png = await renderTextOverlayPng(seg.texts, width, height, projectWidth ?? width);
    if (!png) return null;
    const name = `txt_${index}.png`;
    await ff.writeFile(name, png);
    return name;
  };
  const overlayChain = (source: string) => `${source}[2:v]overlay=0:0:eof_action=repeat[v]`;

  report('Préparation des clips…', 0);
  const segmentNames: string[] = [];
  const overlayNames: string[] = [];
  let processed = 0;
  const total = segments.length + audioClips.length;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const d = fmt(Math.max(0.04, seg.durationSec));
    const outName = `vseg_${i}.mp4`;
    const clip = seg.clip;

    const textPng = await textOverlayFor(seg, i);
    if (textPng) overlayNames.push(textPng);
    const textInput = textPng ? ['-i', textPng] : [];

    if (!clip) {
      // Segment noir (trou entre deux clips, ou texte sur fond noir)
      await ff.exec([
        '-f', 'lavfi', '-t', d, '-i', `color=c=black:s=${width}x${height}:r=${fps}`,
        '-f', 'lavfi', '-t', d, '-i', 'anullsrc=r=44100:cl=stereo',
        ...textInput,
        ...(textPng
          ? ['-filter_complex', overlayChain('[0:v]'), '-map', '[v]', '-map', '1:a:0']
          : []),
        ...encodeArgs,
        '-shortest',
        '-y',
        outName,
      ]);
    } else if (clip.type === 'image') {
      // Boucle l'image pendant la durée voulue, encode H.264, ajoute une piste audio silencieuse.
      const inputName = await inputFor(clip);
      await ff.exec([
        '-loop', '1', '-t', d, '-i', inputName,
        '-f', 'lavfi', '-t', d, '-i', 'anullsrc=r=44100:cl=stereo',
        ...textInput,
        ...(textPng
          ? ['-filter_complex', `[0:v]${scaleFilter}[bg];${overlayChain('[bg]')}`, '-map', '[v]', '-map', '1:a:0']
          : ['-vf', scaleFilter]),
        ...encodeArgs,
        '-shortest',
        '-y',
        outName,
      ]);
    } else {
      // Clip vidéo : lu à partir de son point d'entrée, deux entrées (source +
      // silence) pour garantir un flux audio même si la source n'en a pas.
      const inputName = await inputFor(clip);
      const muted = !!clip.muted || !!trackById.get(clip.track)?.muted;
      const videoChain = textPng ? `[0:v]${scaleFilter}[bg];${overlayChain('[bg]')}` : null;
      const head = [
        '-ss', fmt(seg.inSec), '-i', inputName,
        '-f', 'lavfi', '-t', d, '-i', 'anullsrc=r=44100:cl=stereo',
        ...textInput,
        '-t', d,
        ...(videoChain ? [] : ['-vf', scaleFilter]),
      ];
      const videoMap = videoChain ? ['-map', '[v]'] : ['-map', '0:v:0'];
      const tail = [...encodeArgs, '-y', outName];
      const silentArgs = [
        ...head,
        ...(videoChain ? ['-filter_complex', videoChain] : []),
        ...videoMap, '-map', '1:a:0',
        ...tail,
      ];
      if (muted) {
        await ff.exec(silentArgs);
      } else {
        const volume = Math.min(1, Math.max(0, clip.volume ?? 1)).toFixed(3);
        const audioChain = `[0:a]volume=${volume}[va];[va][1:a]amix=inputs=2:duration=longest:normalize=0[a]`;
        const code = await ff.exec([
          ...head,
          '-filter_complex', videoChain ? `${videoChain};${audioChain}` : audioChain,
          ...videoMap, '-map', '[a]',
          ...tail,
        ]);
        // Source sans flux audio ([0:a] introuvable) : on relance avec le silence
        if (code !== 0) await ff.exec(silentArgs);
      }
    }

    segmentNames.push(outName);
    processed++;
    report(`Préparation des clips… (${processed}/${total})`, (processed / total) * 50);
  }
  for (const name of inputBySrc.values()) await ff.deleteFile(name).catch(() => undefined);

  // 2) Concat des segments via le concat demuxer
  report('Assemblage de la timeline…', 55);
  const listContent = segmentNames.map((n) => `file '${concatEscape(n)}'`).join('\n');
  await ff.writeFile('concat.txt', new TextEncoder().encode(listContent));
  await ff.exec([
    '-f', 'concat',
    '-safe', '0',
    '-i', 'concat.txt',
    '-c', 'copy',
    '-y',
    'video_only.mp4',
  ]);
  for (const n of segmentNames) await ff.deleteFile(n).catch(() => undefined);
  for (const n of overlayNames) await ff.deleteFile(n).catch(() => undefined);

  // 3) Clips audio : point d'entrée, volume puis délai absolu (une seule chaîne -af)
  const audioInputs: string[] = [];
  if (audioClips.length > 0) {
    report('Mixage audio…', 60);
    for (let i = 0; i < audioClips.length; i++) {
      const clip = audioClips[i];
      const durationSec = Math.max(0.04, clip.width / pixelsPerSecond);
      const inputName = `ain_${i}.bin`;
      const outName = `aseg_${i}.wav`;
      await ff.writeFile(inputName, await fetchBytes(clip.src));
      const startMs = Math.round((clip.start / pixelsPerSecond) * 1000);
      const volume = Math.min(1, Math.max(0, clip.volume ?? 1)).toFixed(3);
      await ff.exec([
        '-ss', fmt((clip.offset ?? 0) / pixelsPerSecond),
        '-i', inputName,
        '-t', fmt(durationSec),
        '-af', `volume=${volume},adelay=${startMs}|${startMs}`,
        '-ar', '44100',
        '-ac', '2',
        '-y',
        outName,
      ]);
      await ff.deleteFile(inputName).catch(() => undefined);
      audioInputs.push(outName);
      processed++;
      report(`Mixage audio… (${processed}/${total})`, 50 + (processed / total) * 35);
    }
  }

  // 4) Mux final : l'audio des vidéos (déjà dans video_only.mp4) est mixé
  //    avec les clips audio ; `duration=first` = durée de la vidéo, qui couvre
  //    déjà la fin globale.
  report('Encodage final…', 90);
  if (audioInputs.length > 0) {
    const args: string[] = ['-i', 'video_only.mp4'];
    for (const a of audioInputs) args.push('-i', a);
    const labels = audioInputs.map((_, i) => `[${i + 1}:a]`).join('');
    args.push(
      '-filter_complex', `[0:a]${labels}amix=inputs=${audioInputs.length + 1}:duration=first:normalize=0[a]`,
      '-map', '0:v:0',
      '-map', '[a]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-y',
      'output.mp4',
    );
    await ff.exec(args);
  } else {
    await ff.exec(['-i', 'video_only.mp4', '-c', 'copy', '-y', 'output.mp4']);
  }

  const data = await ff.readFile('output.mp4');
  await ff.deleteFile('video_only.mp4').catch(() => undefined);
  await ff.deleteFile('output.mp4').catch(() => undefined);
  await ff.deleteFile('concat.txt').catch(() => undefined);
  for (const a of audioInputs) await ff.deleteFile(a).catch(() => undefined);

  report('Terminé', 100);
  // data peut être Uint8Array | string ; ici on est binaire.
  const bytes = data as Uint8Array;
  // Copie dans un ArrayBuffer "pur" (le typage Uint8Array.buffer peut être SharedArrayBuffer
  // selon le build TS strict ; on évite l'erreur de typage Blob).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Blob([ab], { type: 'video/mp4' });
}
