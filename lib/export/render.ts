"use client";

import { fetchFile } from '@ffmpeg/util';
import { getFFmpeg } from './ffmpeg';
import type { Clip } from '@/components/ProjectContext';

export type RenderProgress = (info: { stage: string; percent: number }) => void;

interface RenderOptions {
  clips: Clip[];
  pixelsPerSecond: number; // pour convertir start_px / width_px en secondes
  width: number;
  height: number;
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

/**
 * Rend la timeline vidéo en MP4.
 *
 * Stratégie v1 :
 *  1. Pour chaque clip image/vidéo (pistes vidéo) : on génère un segment MP4
 *     normalisé (résolution + fps cibles, codec H.264, audio AAC silencieux).
 *  2. On les concatène dans l'ordre du `start`.
 *  3. On mixe tous les clips audio des pistes audio en une piste WAV.
 *  4. On mux la vidéo concaténée et l'audio mixé.
 *
 * Limitations v1 :
 *  - Pas de texte overlay (clips type 'text' ignorés)
 *  - Pas de transformations (rotation/scale/position) — chaque clip est juste mis à l'échelle
 *  - Pas de gestion des "gaps" : on suppose que les clips se suivent
 */
export async function renderProjectToMp4({
  clips,
  pixelsPerSecond,
  width,
  height,
  fps = 30,
  onProgress,
}: RenderOptions): Promise<Blob> {
  const ff = await getFFmpeg();

  const report = (stage: string, percent: number) => {
    onProgress?.({ stage, percent });
  };

  // 1) Trie & filtre les clips visuels (vidéo + image) par start
  const visualClips = clips
    .filter((c) => c.type === 'video' || c.type === 'image')
    .filter((c) => !!c.src)
    .sort((a, b) => a.start - b.start);

  if (visualClips.length === 0) {
    throw new Error('Aucun clip vidéo ou image à exporter.');
  }

  const audioClips = clips.filter((c) => c.type === 'audio' && !!c.src);

  // 2) Génère un segment MP4 normalisé par clip visuel
  report('Préparation des clips…', 0);
  const segmentNames: string[] = [];
  let processed = 0;
  const total = visualClips.length + audioClips.length;

  for (let i = 0; i < visualClips.length; i++) {
    const clip = visualClips[i];
    const durationSec = Math.max(0.04, clip.width / pixelsPerSecond);
    const inputName = `vin_${i}${clip.type === 'video' ? '.mp4' : '.img'}`;
    const outName = `vseg_${i}.mp4`;

    await ff.writeFile(inputName, await fetchBytes(clip.src));

    const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps}`;

    if (clip.type === 'image') {
      // Boucle l'image pendant la durée voulue, encode H.264, ajoute une piste audio silencieuse.
      await ff.exec([
        '-loop', '1',
        '-t', durationSec.toFixed(3),
        '-i', inputName,
        '-f', 'lavfi',
        '-t', durationSec.toFixed(3),
        '-i', 'anullsrc=r=44100:cl=stereo',
        '-vf', scaleFilter,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-shortest',
        '-y',
        outName,
      ]);
    } else {
      // Clip vidéo : trim à la durée du clip et normalise.
      await ff.exec([
        '-i', inputName,
        '-t', durationSec.toFixed(3),
        '-vf', scaleFilter,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-c:a', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-y',
        outName,
      ]);
    }

    await ff.deleteFile(inputName).catch(() => undefined);
    segmentNames.push(outName);
    processed++;
    report(`Préparation des clips… (${processed}/${total})`, (processed / total) * 50);
  }

  // 3) Concat des segments via le concat demuxer
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

  // 4) Audio des pistes audio (si présentes), mixé
  let audioPath: string | null = null;
  if (audioClips.length > 0) {
    report('Mixage audio…', 70);
    const audioInputs: string[] = [];
    for (let i = 0; i < audioClips.length; i++) {
      const clip = audioClips[i];
      const durationSec = Math.max(0.04, clip.width / pixelsPerSecond);
      const inputName = `ain_${i}.bin`;
      const outName = `aseg_${i}.wav`;
      await ff.writeFile(inputName, await fetchBytes(clip.src));
      // Délai = position de départ (en ms), pour que les clips audio se placent au bon moment.
      const startMs = Math.round((clip.start / pixelsPerSecond) * 1000);
      await ff.exec([
        '-i', inputName,
        '-t', durationSec.toFixed(3),
        '-af', `adelay=${startMs}|${startMs}`,
        '-ar', '44100',
        '-ac', '2',
        '-y',
        outName,
      ]);
      await ff.deleteFile(inputName).catch(() => undefined);
      audioInputs.push(outName);
      processed++;
      report(`Mixage audio… (${processed}/${total})`, 70 + (processed / total) * 15);
    }

    // Mix de toutes les pistes audio
    if (audioInputs.length === 1) {
      audioPath = audioInputs[0];
    } else {
      const mixArgs: string[] = [];
      for (const a of audioInputs) mixArgs.push('-i', a);
      mixArgs.push(
        '-filter_complex', `amix=inputs=${audioInputs.length}:normalize=0`,
        '-c:a', 'aac',
        '-y',
        'audio_mix.aac',
      );
      await ff.exec(mixArgs);
      for (const a of audioInputs) await ff.deleteFile(a).catch(() => undefined);
      audioPath = 'audio_mix.aac';
    }
  }

  // 5) Mux final : remplace la piste audio des vidéos par le mix (si présent),
  //    sinon on garde l'audio des vidéos d'origine.
  report('Encodage final…', 90);
  if (audioPath) {
    await ff.exec([
      '-i', 'video_only.mp4',
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      '-y',
      'output.mp4',
    ]);
  } else {
    await ff.exec(['-i', 'video_only.mp4', '-c', 'copy', '-y', 'output.mp4']);
  }

  const data = await ff.readFile('output.mp4');
  await ff.deleteFile('video_only.mp4').catch(() => undefined);
  await ff.deleteFile('output.mp4').catch(() => undefined);
  await ff.deleteFile('concat.txt').catch(() => undefined);
  if (audioPath) await ff.deleteFile(audioPath).catch(() => undefined);

  report('Terminé', 100);
  // data peut être Uint8Array | string ; ici on est binaire.
  const bytes = data as Uint8Array;
  return new Blob([bytes], { type: 'video/mp4' });
}
