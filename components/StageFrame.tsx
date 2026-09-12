"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProjectSettings } from '@/lib/timeline/types';

/**
 * Cadre de composition : ses enfants sont disposés dans les pixels du PROJET
 * (1920 × 1080 par exemple), puis le cadre entier est mis à l'échelle de la
 * zone d'affichage. Positions, tailles, rotations et échelles sont donc
 * exactement celles du rendu final, dans l'aperçu comme dans le lecteur
 * public.
 */
export default function StageFrame({
  settings, children, className = '',
}: { settings: ProjectSettings; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

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
    <div ref={ref} className={`absolute inset-0 overflow-hidden ${className}`}>
      <div
        style={{
          width: settings.width,
          height: settings.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'relative',
          // Tant que la mesure n'est pas faite, on n'affiche pas un cadre géant
          visibility: scale > 0 ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}
