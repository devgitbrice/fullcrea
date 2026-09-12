"use client";

import type { Clip } from '@/lib/timeline/types';
import {
  TEXT_LINE_HEIGHT, TEXT_MAX_WIDTH_RATIO, TEXT_SHADOW, textTransform,
} from '@/lib/timeline/textLayout';

// Les constantes de mise en page viennent de lib/timeline/textLayout : l'aperçu,
// le lecteur public et l'export partagent exactement la même géométrie. Tout est
// exprimé en pixels projet, mis à l'échelle de la résolution de sortie.

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
  const maxWidth = width * TEXT_MAX_WIDTH_RATIO;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const clip of texts) {
    const content = (clip.text ?? '').trim();
    if (!content) continue;
    const t = textTransform(clip);
    const fontSize = (clip.fontSize || 48) * scale;

    ctx.save();
    // Position, rotation et échelle autour du centre du bloc, comme en CSS
    ctx.translate(width / 2 + t.positionX * scale, height / 2 + t.positionY * scale);
    if (t.rotationZ) ctx.rotate((t.rotationZ * Math.PI) / 180);
    if (t.scaleX !== 1 || t.scaleY !== 1) ctx.scale(t.scaleX, t.scaleY);

    ctx.font = `${fontSize}px ${clip.fontFamily || 'Arial'}, sans-serif`;
    ctx.fillStyle = clip.textColor || '#ffffff';
    ctx.shadowColor = TEXT_SHADOW.color;
    ctx.shadowBlur = TEXT_SHADOW.blur * scale;
    ctx.shadowOffsetX = TEXT_SHADOW.offset * scale;
    ctx.shadowOffsetY = TEXT_SHADOW.offset * scale;

    const lines = wrapLines(ctx, content, maxWidth);
    const lineHeight = fontSize * TEXT_LINE_HEIGHT;
    // Bloc centré verticalement sur l'origine, comme l'aperçu
    const top = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, top + i * lineHeight, maxWidth);
    });
    ctx.restore();
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
