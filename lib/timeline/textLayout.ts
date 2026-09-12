// Mise en page d'un clip texte, partagée par l'aperçu, le lecteur public et
// l'export : c'est la seule source de vérité pour que le texte ait exactement
// les mêmes proportions partout.
import type { Clip, ImageTransform } from './types';

/** Largeur maximale du bloc de texte, en fraction du cadre. */
export const TEXT_MAX_WIDTH_RATIO = 0.9;
/** Interligne (multiple de la taille de police). */
export const TEXT_LINE_HEIGHT = 1.2;
/** Ombre portée, exprimée en pixels projet. */
export const TEXT_SHADOW = { offset: 2, blur: 4, color: 'rgba(0,0,0,0.8)' };

export const DEFAULT_TEXT_TRANSFORM: ImageTransform = {
  rotationX: 0, rotationY: 0, rotationZ: 0,
  scaleX: 1, scaleY: 1, positionX: 0, positionY: 0,
};

export function textTransform(clip: Clip): ImageTransform {
  return clip.transform ?? DEFAULT_TEXT_TRANSFORM;
}

/**
 * Transformation CSS d'un bloc de texte : déplacement en pixels projet, puis
 * rotation et échelle autour de son centre. Le cadre qui la contient est
 * lui-même mis à l'échelle de l'aperçu, donc les valeurs restent celles du
 * projet (et donc du rendu final).
 */
export function textTransformCss(clip: Clip): string {
  const t = textTransform(clip);
  return `translate(${t.positionX}px, ${t.positionY}px) rotate(${t.rotationZ || 0}deg) scale(${t.scaleX}, ${t.scaleY})`;
}

/**
 * Transformation CSS d'un clip visuel (image ou vidéo), exprimée elle aussi en
 * pixels projet : même convention que le texte et que l'export.
 * L'inclinaison 3D reste une fantaisie d'aperçu (non rendue à l'export).
 */
export function visualTransformCss(clip: Clip): string {
  const t = textTransform(clip);
  return [
    `translate(${t.positionX}px, ${t.positionY}px)`,
    t.rotationX ? `rotateX(${t.rotationX}deg)` : '',
    t.rotationY ? `rotateY(${t.rotationY}deg)` : '',
    `rotate(${t.rotationZ || 0}deg)`,
    `scale(${t.scaleX}, ${t.scaleY})`,
  ].filter(Boolean).join(' ');
}
