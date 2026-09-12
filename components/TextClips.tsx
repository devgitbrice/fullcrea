"use client";

import type { Clip } from '@/lib/timeline/types';
import {
  TEXT_LINE_HEIGHT, TEXT_MAX_WIDTH_RATIO, TEXT_SHADOW, textTransformCss,
} from '@/lib/timeline/textLayout';

/**
 * Clips texte d'un montage, à placer dans un StageFrame : tout est exprimé en
 * pixels projet (taille de police, position, rotation, échelle).
 */
export default function TextClips({ texts }: { texts: Clip[] }) {
  return (
    <>
      {texts.map((clip) => (
        <div key={clip.id} className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span
            data-text-clip={clip.id}
            style={{
              fontSize: `${clip.fontSize || 48}px`,
              fontFamily: `${clip.fontFamily || 'Arial'}, sans-serif`,
              color: clip.textColor || '#ffffff',
              textShadow: `${TEXT_SHADOW.offset}px ${TEXT_SHADOW.offset}px ${TEXT_SHADOW.blur}px ${TEXT_SHADOW.color}`,
              whiteSpace: 'pre-wrap',
              textAlign: 'center',
              lineHeight: TEXT_LINE_HEIGHT,
              maxWidth: `${TEXT_MAX_WIDTH_RATIO * 100}%`,
              transform: textTransformCss(clip),
            }}
          >
            {clip.text || 'Texte'}
          </span>
        </div>
      ))}
    </>
  );
}
