"use client";

import { useEffect, useRef, useState } from 'react';
import type { Clip, ProjectSettings } from '@/lib/timeline/types';
import {
  TEXT_LINE_HEIGHT, TEXT_MAX_WIDTH_RATIO, TEXT_SHADOW, textTransformCss,
} from '@/lib/timeline/textLayout';

/**
 * Calque des textes d'un montage, posé sur la scène.
 *
 * Le contenu est composé dans un cadre aux dimensions du projet (pixels
 * projet), puis ce cadre entier est mis à l'échelle de l'aperçu : taille de
 * police, position, rotation et échelle sont donc exactement celles du rendu
 * final, quelle que soit la taille d'affichage.
 */
export default function TextLayer({ texts, settings }: { texts: Clip[]; settings: ProjectSettings }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  // Le conteneur est toujours monté (même sans texte) : la mesure reste valable
  // quand un texte apparaît, y compris après l'hydratation du projet.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / (settings.width || 1));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [settings.width]);

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden pointer-events-none z-30">
      {texts.length > 0 && (
      <div
        style={{
          width: settings.width,
          height: settings.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // Tant que la mesure n'est pas faite, on n'affiche pas un texte géant
          visibility: scale > 0 ? 'visible' : 'hidden',
        }}
      >
        {texts.map((clip) => (
          <div key={clip.id} className="absolute inset-0 flex items-center justify-center">
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
      </div>
      )}
    </div>
  );
}
