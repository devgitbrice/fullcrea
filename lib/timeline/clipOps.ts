// Helpers purs sur les clips et les pistes (sans React), partagés par le
// contexte, la timeline, le lecteur et l'export. Testés par `node --test`.
import type { Clip, Track } from './types';
import { MIN_CLIP_WIDTH_PX, PX_PER_SEC_BASE } from './types.ts';

const EPSILON = 1e-6;

/** Id court : `${prefix}_xxxxxxxx` (8 hex de randomUUID, repli horodaté). */
export function newId(prefix: string): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return `${prefix}_${c.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const clipEnd = (c: Clip): number => c.start + c.width;

/** Temps (s) dans la source correspondant à `timePx` sur la timeline. */
export function mediaTimeSec(clip: Clip, timePx: number): number {
  return ((clip.offset ?? 0) + (timePx - clip.start)) / PX_PER_SEC_BASE;
}

const hasOffset = (c: Clip): boolean => c.type === 'video' || c.type === 'audio';

/**
 * Coupe un clip à `timePx`. `null` si l'une des moitiés serait plus courte
 * que MIN_CLIP_WIDTH_PX. La moitié droite reprend la source là où la coupe
 * tombe (offset avancé, vidéo/audio seulement).
 */
export function splitClip(clip: Clip, timePx: number, ids: [string, string]): [Clip, Clip] | null {
  const end = clipEnd(clip);
  if (timePx - clip.start < MIN_CLIP_WIDTH_PX || end - timePx < MIN_CLIP_WIDTH_PX) return null;
  const left: Clip = { ...clip, id: ids[0], width: timePx - clip.start };
  const right: Clip = { ...clip, id: ids[1], start: timePx, width: end - timePx };
  if (hasOffset(clip)) right.offset = (clip.offset ?? 0) + (timePx - clip.start);
  if (clip.transform) {
    left.transform = { ...clip.transform };
    right.transform = { ...clip.transform };
  }
  return [left, right];
}

/** id de piste → index dans `tracks` (plus grand = couche du dessus). */
export function trackOrder(tracks: Track[]): Map<number, number> {
  return new Map(tracks.map((t, i) => [t.id, i]));
}

export function clipsOnTrack(clips: Clip[], trackId: number): Clip[] {
  return clips.filter(c => c.track === trackId);
}

/** Vrai si un autre clip de la même piste (hors `ignoreIds`) recouvre `candidate`. */
export function overlapsOnTrack(clips: Clip[], candidate: Clip, ignoreIds?: ReadonlySet<string>): boolean {
  const candidateEnd = clipEnd(candidate);
  return clips.some(c =>
    c.id !== candidate.id
    && c.track === candidate.track
    && !ignoreIds?.has(c.id)
    && c.start < candidateEnd && candidate.start < clipEnd(c)
  );
}

/**
 * Plus petit start ≥ candidate.start sans chevauchement : on saute à la fin
 * du premier clip gênant jusqu'à trouver une place libre.
 */
export function findFreeStart(clips: Clip[], candidate: Clip, ignoreIds?: ReadonlySet<string>): number {
  let start = candidate.start;
  for (let i = 0; i <= clips.length; i++) {
    const probe = { ...candidate, start };
    const probeEnd = clipEnd(probe);
    let nextStart = Infinity;
    for (const c of clips) {
      if (c.id === candidate.id || c.track !== candidate.track || ignoreIds?.has(c.id)) continue;
      if (c.start < probeEnd && start < clipEnd(c)) nextStart = Math.min(nextStart, clipEnd(c));
    }
    if (nextStart === Infinity) return start;
    start = nextStart;
  }
  return start;
}

/**
 * Plus petit delta ≥ 0 appliqué à tous les `candidates` (chacun sur sa piste)
 * pour qu'aucun ne chevauche un clip de `clips` hors du groupe.
 */
export function findFreeGroupDelta(clips: Clip[], candidates: Clip[]): number {
  const ids = new Set(candidates.map(c => c.id));
  const obstacles = clips.filter(c => !ids.has(c.id));
  let delta = 0;
  // Chaque itération dépasse au moins un obstacle : borné par obstacles × candidats
  const maxIterations = obstacles.length * candidates.length + 1;
  for (let i = 0; i < maxIterations; i++) {
    let nextDelta = delta;
    for (const cand of candidates) {
      const start = cand.start + delta;
      const end = start + cand.width;
      for (const c of obstacles) {
        if (c.track !== cand.track) continue;
        if (c.start < end && start < clipEnd(c)) {
          nextDelta = Math.max(nextDelta, clipEnd(c) - cand.start);
        }
      }
      // On avance d'abord jusqu'au premier obstacle gênant, puis on re-vérifie
      if (nextDelta > delta) break;
    }
    if (nextDelta === delta) return delta;
    delta = nextDelta;
  }
  return delta;
}

/** Fin du voisin de gauche (0 si aucun) et début du voisin de droite (Infinity si aucun). */
export function neighborBounds(clips: Clip[], clip: Clip): { prevEnd: number; nextStart: number } {
  const end = clipEnd(clip);
  let prevEnd = 0;
  let nextStart = Infinity;
  for (const c of clips) {
    if (c.id === clip.id || c.track !== clip.track) continue;
    const cEnd = clipEnd(c);
    if (cEnd <= clip.start) prevEnd = Math.max(prevEnd, cEnd);
    if (c.start >= end) nextStart = Math.min(nextStart, c.start);
  }
  return { prevEnd, nextStart };
}

/** Bornes d'un trim, calculées depuis l'état initial du clip (jamais cumulées). */
export interface TrimBounds {
  minStart: number;   // bord gauche : point d'entrée 0 (vidéo/audio) et fin du voisin de gauche
  maxStart: number;   // bord gauche : garde MIN_CLIP_WIDTH_PX
  minEnd: number;     // bord droit : garde MIN_CLIP_WIDTH_PX
  maxEnd: number;     // bord droit : fin de la source (si connue) et début du voisin de droite
}

/**
 * Bornes de trim d'un clip : un clip vidéo/audio ne peut pas s'étendre à
 * gauche au-delà de `offset = 0` ni à droite au-delà de `sourceDuration`
 * (quand elle est connue) ; tous les clips sont bloqués par leurs voisins de
 * piste. Le clamp s'applique APRÈS l'aimantation.
 */
export function trimBounds(clips: Clip[], clip: Clip): TrimBounds {
  const { prevEnd, nextStart } = neighborBounds(clips, clip);
  const offset = clip.offset ?? 0;
  const end = clipEnd(clip);
  const sourceEnd = hasOffset(clip) && clip.sourceDuration != null
    ? clip.start - offset + clip.sourceDuration
    : Infinity;
  return {
    minStart: hasOffset(clip) ? Math.max(clip.start - offset, prevEnd) : prevEnd,
    maxStart: end - MIN_CLIP_WIDTH_PX,
    minEnd: clip.start + MIN_CLIP_WIDTH_PX,
    maxEnd: Math.min(sourceEnd, nextStart),
  };
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Supprime `ids` et referme les trous : par piste, du clip supprimé le plus
 * tardif au plus tôt, les clips restants qui commencent à (ou après) la fin
 * du supprimé reculent de sa largeur. Un clip chevauchant le trou ne bouge pas.
 */
export function computeRipple(clips: Clip[], ids: string[]): Clip[] {
  const idSet = new Set(ids);
  const deleted = clips.filter(c => idSet.has(c.id)).sort((a, b) => b.start - a.start);
  let remaining = clips.filter(c => !idSet.has(c.id));
  for (const d of deleted) {
    const dEnd = clipEnd(d);
    remaining = remaining.map(c =>
      c.track === d.track && c.start >= dEnd - EPSILON
        ? { ...c, start: c.start - d.width }
        : c
    );
  }
  return remaining;
}

/** Bords (starts et ends) des clips des pistes données, plus 0 : triés, dédoublonnés. */
export function clipEdges(clips: Clip[], trackIds: ReadonlySet<number>): number[] {
  const edges = new Set<number>([0]);
  for (const c of clips) {
    if (!trackIds.has(c.track)) continue;
    edges.add(c.start);
    edges.add(clipEnd(c));
  }
  return [...edges].sort((a, b) => a - b);
}

const coversTime = (c: Clip, t: number): boolean => c.start <= t && t < clipEnd(c);

// Gagnant parmi des candidats : ordre de piste le plus haut, puis start le plus grand
function pickTop(candidates: Clip[], order: Map<number, number>): Clip | null {
  let best: Clip | null = null;
  for (const c of candidates) {
    if (!best) { best = c; continue; }
    const o = order.get(c.track)!;
    const bo = order.get(best.track)!;
    if (o > bo || (o === bo && c.start > best.start)) best = c;
  }
  return best;
}

/** Clip vidéo/image visible à `timePx` (pistes vidéo non masquées, couche du dessus). */
export function findActiveVisual(clips: Clip[], tracks: Track[], timePx: number): Clip | null {
  const order = trackOrder(tracks);
  const visibleTracks = new Set(tracks.filter(t => t.type === 'video' && !t.hidden).map(t => t.id));
  const candidates = clips.filter(c =>
    (c.type === 'video' || c.type === 'image') && visibleTracks.has(c.track) && coversTime(c, timePx)
  );
  return pickTop(candidates, order);
}

/** Clip audio audible à `timePx` (pistes audio non muettes, clip non muet, couche du dessus). */
export function findActiveAudio(clips: Clip[], tracks: Track[], timePx: number): Clip | null {
  const order = trackOrder(tracks);
  const audibleTracks = new Set(tracks.filter(t => t.type === 'audio' && !t.muted).map(t => t.id));
  const candidates = clips.filter(c =>
    c.type === 'audio' && !c.muted && audibleTracks.has(c.track) && coversTime(c, timePx)
  );
  return pickTop(candidates, order);
}

/** Clip audio actif d'UNE piste (un <audio> par piste dans le lecteur) : start le plus grand gagne. */
export function findActiveAudioOnTrack(clips: Clip[], trackId: number, timePx: number): Clip | null {
  let best: Clip | null = null;
  for (const c of clips) {
    if (c.type !== 'audio' || c.track !== trackId || c.muted || !coversTime(c, timePx)) continue;
    if (!best || c.start > best.start) best = c;
  }
  return best;
}

export function isClipLocked(clip: Clip, tracks: Track[]): boolean {
  return !!tracks.find(t => t.id === clip.track)?.locked;
}

// --- TIMELINES IMBRIQUÉES (clips de type 'sequence') ---

/** Durée d'une timeline (px) = fin du clip le plus tardif. */
export function sequenceDurationPx(clips: Clip[]): number {
  return clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/**
 * Vrai si insérer `refId` dans la timeline `hostId` créerait un cycle
 * (`refId` contient déjà `hostId`, directement ou indirectement).
 */
export function wouldCreateCycle(
  sequences: { id: string; clips: Clip[] }[],
  hostId: string,
  refId: string,
  seen: Set<string> = new Set(),
): boolean {
  if (refId === hostId) return true;
  if (seen.has(refId)) return false;
  seen.add(refId);
  const seq = sequences.find(s => s.id === refId);
  if (!seq) return false;
  return seq.clips.some(c =>
    c.type === 'sequence' && !!c.sequenceRef && wouldCreateCycle(sequences, hostId, c.sequenceRef, seen)
  );
}

const MAX_NEST_DEPTH = 8;

/**
 * Remplace les clips 'sequence' par le contenu de la timeline référencée,
 * replacé dans le temps de la timeline hôte et rogné à la fenêtre du clip.
 * Utilisé par le lecteur et par l'export : ni l'un ni l'autre ne connaît les
 * timelines imbriquées, ils ne voient que des clips ordinaires.
 */
export function flattenClips(
  clips: Clip[],
  sequences: { id: string; clips: Clip[] }[],
  depth = 0,
): Clip[] {
  if (depth > MAX_NEST_DEPTH) return [];
  // Cas courant : aucune timeline imbriquée, on garde le tableau d'origine
  // (identité préservée pour les mémos du lecteur).
  if (!clips.some(c => c.type === 'sequence')) return clips;
  const out: Clip[] = [];
  for (const clip of clips) {
    if (clip.type !== 'sequence') {
      out.push(clip);
      continue;
    }
    const seq = clip.sequenceRef ? sequences.find(s => s.id === clip.sequenceRef) : undefined;
    if (!seq) continue;
    const inner = flattenClips(seq.clips, sequences, depth + 1);
    const windowStart = clip.start;
    const windowEnd = clipEnd(clip);
    // Décalage : le point d'entrée du clip conteneur se lit dans le temps interne
    const shift = clip.start - (clip.offset ?? 0);
    for (const c of inner) {
      const start = c.start + shift;
      const end = start + c.width;
      const visibleStart = Math.max(start, windowStart);
      const visibleEnd = Math.min(end, windowEnd);
      if (visibleEnd - visibleStart < 1e-6) continue;
      const trimmedLeft = visibleStart - start;
      out.push({
        ...c,
        id: `${clip.id}/${c.id}`,
        start: visibleStart,
        width: visibleEnd - visibleStart,
        offset: hasOffset(c) ? (c.offset ?? 0) + trimmedLeft : c.offset,
        muted: c.muted || clip.muted,
        volume: (c.volume ?? 1) * (clip.volume ?? 1),
      });
    }
  }
  return out;
}
