"use client";

import type { Clip } from '@/lib/timeline/types';

// Mêmes valeurs que l'aperçu (Player) et le lecteur public (LivePlayer) :
// la taille de police est exprimée dans les pixels du projet et suit donc la
// résolution de sortie ; l'ombre est calculée sur la même échelle.
const MAX_WIDTH_RATIO = 0.9;
const LINE_HEIGHT = 1.2;
const SHADOW_OFFSET = 2;
const SHADOW_BLUR = 4;

/** Découpe un texte en lignes tenant dans `maxWidth` (retours à la ligne conservés). */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * Dessine les clips texte actifs sur un PNG transparent à la résolution de
 * sortie. L'export compose ensuite ce calque sur l'image : le texte a donc
 * exactement les mêmes proportions qu'à l'aperçu et via le lien de partage.
 * Renvoie null si rien n'est à dessiner ou si le canvas est indisponible.
 */
export async function renderTextOverlayPng(
  texts: Clip[],
  width: number,
  height: number,
  projectWidth: number,
): Promise<Uint8Array | null> {
  if (texts.length === 0 || typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Le projet est composé en « pixels projet » : on suit la mise à l'échelle
  const scale = width / (projectWidth || width);
  const maxWidth = width * MAX_WIDTH_RATIO;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const clip of texts) {
    const content = (clip.text ?? '').trim();
    if (!content) continue;
    const fontSize = (clip.fontSize || 48) * scale;
    ctx.font = `${fontSize}px ${clip.fontFamily || 'Arial'}, sans-serif`;
    ctx.fillStyle = clip.textColor || '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = SHADOW_BLUR * scale;
    ctx.shadowOffsetX = SHADOW_OFFSET * scale;
    ctx.shadowOffsetY = SHADOW_OFFSET * scale;

    const lines = wrapLines(ctx, content, maxWidth);
    const lineHeight = fontSize * LINE_HEIGHT;
    // Bloc centré verticalement, comme l'aperçu
    const top = height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, width / 2, top + i * lineHeight, maxWidth);
    });
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
