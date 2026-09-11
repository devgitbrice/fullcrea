// Formatage des temps (px timeline → texte), partagé par le lecteur, la
// timeline et l'export.
import { PX_PER_SEC_BASE } from './types.ts';

const DEFAULT_FPS = 30;
// Absorbe le bruit flottant (31 / 30 * 30 = 30.999…) pour ne pas afficher l'image précédente
const EPSILON = 1e-6;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Timecode HH:MM:SS:II pour une position en px (zoom 1). */
export function formatTimecode(px: number, fps: number): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
  const seconds = (Number.isFinite(px) ? Math.max(0, px) : 0) / PX_PER_SEC_BASE;
  const totalFrames = Math.floor(seconds * safeFps + EPSILON);
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const frames = Math.floor(totalFrames - totalSeconds * safeFps);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(frames)}`;
}

/** MM:SS arrondi à la seconde. */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}
