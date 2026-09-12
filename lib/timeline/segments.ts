// Découpage de la timeline en segments vidéo pour l'export : balayage des
// points de montage (starts/ends), couche du dessus à chaque intervalle,
// segments noirs pour les trous. Pur, testé par `node --test`.
import type { Clip, Track } from './types';
import { clipEnd, findActiveVisual, mediaTimeSec } from './clipOps.ts';

export interface VideoSegment {
  startSec: number;
  durationSec: number;
  clip: Clip | null;   // null = noir
  inSec: number;       // temps source au début du segment
  texts: Clip[];       // textes affichés pendant tout le segment (incrustation)
}

const EPSILON = 1e-6;

/** Clips visuels exportables : vidéo/image avec source, sur une piste vidéo existante non masquée. */
export function exportableVisualClips(clips: Clip[], tracks: Track[]): Clip[] {
  const visible = new Set(tracks.filter(t => t.type === 'video' && !t.hidden).map(t => t.id));
  return clips.filter(c => (c.type === 'video' || c.type === 'image') && !!c.src && visible.has(c.track));
}

/** Clips audio exportables : source, piste audio existante non muette, clip non muet. */
export function exportableAudioClips(clips: Clip[], tracks: Track[]): Clip[] {
  const audible = new Set(tracks.filter(t => t.type === 'audio' && !t.muted).map(t => t.id));
  return clips.filter(c => c.type === 'audio' && !!c.src && !c.muted && audible.has(c.track));
}

/** Clips texte exportables : sur une piste existante non masquée, avec du texte. */
export function exportableTextClips(clips: Clip[], tracks: Track[]): Clip[] {
  const visible = new Set(tracks.filter(t => !t.hidden).map(t => t.id));
  return clips.filter(c => c.type === 'text' && visible.has(c.track) && !!(c.text ?? '').trim());
}

/** Fin globale (px) de tout ce qui est exporté : visuel, texte et audio. */
export function exportEndPx(clips: Clip[], tracks: Track[]): number {
  const all = [
    ...exportableVisualClips(clips, tracks),
    ...exportableTextClips(clips, tracks),
    ...exportableAudioClips(clips, tracks),
  ];
  return all.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

export function buildVideoSegments(clips: Clip[], tracks: Track[], pxPerSec: number, fps: number): VideoSegment[] {
  const visual = exportableVisualClips(clips, tracks);
  const texts = exportableTextClips(clips, tracks);
  const endPx = exportEndPx(clips, tracks);
  if (endPx <= 0) return [];

  // Points de montage triés, dédoublonnés (tolérance 1e-6). Les bords des
  // textes en font partie : l'incrustation est constante sur tout un segment.
  const raw = [0, endPx];
  for (const c of visual) raw.push(c.start, clipEnd(c));
  for (const c of texts) raw.push(c.start, clipEnd(c));
  raw.sort((a, b) => a - b);
  const points: number[] = [];
  for (const p of raw) {
    if (points.length === 0 || p - points[points.length - 1] > EPSILON) points.push(p);
  }

  const minDuration = 0.5 / fps;
  const segments: VideoSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const durationSec = (b - a) / pxPerSec;
    if (durationSec < minDuration) continue;   // intervalle < 0,5 image : ignoré
    const clip = findActiveVisual(visual, tracks, a);
    const active = texts.filter(t => t.start <= a + EPSILON && clipEnd(t) > a + EPSILON);
    const prev = segments[segments.length - 1];
    // Fusion des intervalles noirs consécutifs, sauf si le texte change
    if (!clip && prev && !prev.clip && prev.texts.length === 0 && active.length === 0) {
      prev.durationSec = b / pxPerSec - prev.startSec;
      continue;
    }
    segments.push({
      startSec: a / pxPerSec,
      durationSec,
      clip,
      inSec: clip ? mediaTimeSec(clip, a) : 0,
      texts: active,
    });
  }
  return segments;
}
