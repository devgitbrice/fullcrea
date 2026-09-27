// Effets visuels calculés à un instant donné : zoom progressif (onglet FX) et
// transition d'entrée d'un clip. Fonctions pures, partagées par l'aperçu de
// l'éditeur, le lecteur de partage (Muxeo) et l'export.

import type { Clip, Track, TransitionType, ZoomFx } from './types';
import { clipEnd, findActiveVisual } from './clipOps.ts';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// Courbe exponentielle : départ lent, fin rapide
const EXP_K = 3;

/** Avancement « courbé » d'un zoom : q (0..1, avancement dans le clip) → 0..1. */
export function zoomEase(q: number, curve: ZoomFx['curve']): number {
  const x = clamp01(q);
  if (curve === 'exponential') return (Math.exp(EXP_K * x) - 1) / (Math.exp(EXP_K) - 1);
  return x;
}

/** Facteur d'échelle du zoom d'un clip à `timePx` (1 = pas de zoom). */
export function zoomScaleAt(clip: Clip, timePx: number): number {
  const zoom = clip.fx?.zoom;
  if (!zoom?.enabled || !(zoom.depth > 0) || clip.width <= 0) return 1;
  const amount = Math.min(100, zoom.depth) / 100;
  const e = zoomEase((timePx - clip.start) / clip.width, zoom.curve);
  return 1 + amount * (zoom.direction === 'out' ? 1 - e : e);
}

/** Durée effective (px) d'une transition : jamais plus que la moitié du clip. */
export function transitionDurationPx(clip: Clip): number {
  const d = clip.transition?.duration ?? 0;
  return Math.max(0, Math.min(d, clip.width / 2));
}

export interface TransitionState {
  type: TransitionType;
  /** Avancement 0..1 */
  progress: number;
  /** Visuel affiché juste avant le clip (null = noir) */
  from: Clip | null;
}

/**
 * Transition en cours à `timePx` pour le clip visuel actif `clip`, sinon null.
 * Elle occupe le début du clip et part de ce qui était à l'écran juste avant.
 */
export function transitionAt(clip: Clip | null, clips: Clip[], tracks: Track[], timePx: number): TransitionState | null {
  if (!clip?.transition) return null;
  const d = transitionDurationPx(clip);
  if (d <= 0 || timePx < clip.start || timePx >= clip.start + d) return null;
  const before = findActiveVisual(clips, tracks, clip.start - 0.5);
  return {
    type: clip.transition.type,
    progress: clamp01((timePx - clip.start) / d),
    from: before && before.id !== clip.id && clipEnd(before) > clip.start - 1 ? before : null,
  };
}

export interface LayerStyle {
  opacity: number;
  clipPath: string;
  transform: string;
}

const VISIBLE: LayerStyle = { opacity: 1, clipPath: 'none', transform: 'none' };
const HIDDEN: LayerStyle = { opacity: 0, clipPath: 'none', transform: 'none' };

/**
 * Styles CSS des deux calques pendant une transition : `incoming` = le clip
 * qui entre, `outgoing` = l'image précédente (dessous).
 */
export function transitionStyles(type: TransitionType, progress: number): { incoming: LayerStyle; outgoing: LayerStyle } {
  const p = clamp01(progress);
  switch (type) {
    case 'fade':
      // Fondu au noir : l'image précédente s'éteint, puis la suivante apparaît
      return p < 0.5
        ? { incoming: HIDDEN, outgoing: { ...VISIBLE, opacity: 1 - p * 2 } }
        : { incoming: { ...VISIBLE, opacity: p * 2 - 1 }, outgoing: HIDDEN };
    case 'wipeleft':
      return { incoming: { ...VISIBLE, clipPath: `inset(0 0 0 ${((1 - p) * 100).toFixed(2)}%)` }, outgoing: VISIBLE };
    case 'wiperight':
      return { incoming: { ...VISIBLE, clipPath: `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)` }, outgoing: VISIBLE };
    case 'slideup':
      return { incoming: { ...VISIBLE, transform: `translateY(${((1 - p) * 100).toFixed(2)}%)` }, outgoing: VISIBLE };
    case 'circleopen':
      // 72 % du rayon de référence CSS couvre les coins du cadre
      return { incoming: { ...VISIBLE, clipPath: `circle(${(p * 72).toFixed(2)}% at 50% 50%)` }, outgoing: VISIBLE };
    case 'dissolve':
    default:
      return { incoming: { ...VISIBLE, opacity: p }, outgoing: VISIBLE };
  }
}

/**
 * Nom du filtre ffmpeg `xfade` correspondant (export). Attention : `dissolve`
 * de ffmpeg est une dissolution en pixels aléatoires ; le fondu enchaîné
 * progressif de l'aperçu y correspond à `fade`.
 */
export function xfadeName(type: TransitionType): string {
  if (type === 'dissolve') return 'fade';
  if (type === 'fade') return 'fadeblack';
  return type;
}

/**
 * Expression ffmpeg (zoompan) du facteur de zoom d'un clip, pour un segment
 * qui commence `offsetSec` après le début du clip. `on` = n° d'image du segment.
 */
export function zoomExpr(clip: Clip, offsetSec: number, pxPerSec: number, fps: number): string | null {
  const zoom = clip.fx?.zoom;
  if (!zoom?.enabled || !(zoom.depth > 0) || clip.width <= 0) return null;
  const amount = (Math.min(100, zoom.depth) / 100).toFixed(4);
  const dur = (clip.width / pxPerSec).toFixed(4);
  const q = `min(1,max(0,(${offsetSec.toFixed(4)}+on/${fps})/${dur}))`;
  const e = zoom.curve === 'exponential' ? `(exp(${EXP_K}*${q})-1)/(exp(${EXP_K})-1)` : q;
  return zoom.direction === 'out' ? `1+${amount}*(1-(${e}))` : `1+${amount}*(${e})`;
}

/**
 * Clip qui recevra une transition déposée à `timePx` (sur la piste `trackId`
 * si connue) : de préférence un raccord entre deux visuels qui se touchent,
 * sinon le début de visuel le plus proche. `tolerancePx` borne la distance.
 */
export function pickTransitionTarget(
  clips: Clip[], trackId: number | null, timePx: number, tolerancePx: number,
): Clip | null {
  const visual = clips.filter(c => (c.type === 'image' || c.type === 'video') && (trackId === null || c.track === trackId));
  const hasNeighbourBefore = (c: Clip) =>
    visual.some(o => o.id !== c.id && o.track === c.track && Math.abs(clipEnd(o) - c.start) <= 1);
  const nearest = (list: Clip[]) => {
    let best: Clip | null = null;
    for (const c of list) {
      const dist = Math.abs(c.start - timePx);
      if (dist > tolerancePx) continue;
      if (!best || dist < Math.abs(best.start - timePx)) best = c;
    }
    return best;
  };
  return nearest(visual.filter(hasNeighbourBefore)) ?? nearest(visual);
}
