"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type Ref, type VideoHTMLAttributes } from 'react';
import type { Clip, Track } from '@/lib/timeline/types';
import { clipEnd, findActiveVisual, mediaTimeSec } from '@/lib/timeline/clipOps';
import { transitionAt, transitionStyles, zoomScaleAt } from '@/lib/timeline/effects';
import { visualTransformCss } from '@/lib/timeline/textLayout';

export type TimeSubscribe = (callback: (timePx: number) => void) => () => void;

interface EffectVisualProps {
  /** Visuel actif (image ou vidéo) */
  clip: Clip;
  clips: Clip[];
  tracks: Track[];
  /** Temps courant (px) connu de React : sert à l'arrêt et aux sauts */
  time: number;
  /** Horloge image par image pendant la lecture : zoom et transitions fluides */
  subscribe?: TimeSubscribe;
  videoRef?: Ref<HTMLVideoElement>;
  videoProps?: VideoHTMLAttributes<HTMLVideoElement>;
}

const LAYER = 'absolute inset-0';
const MEDIA = 'absolute inset-0 w-full h-full object-contain';

/**
 * Visuel d'un clip avec ses effets : zoom progressif (onglet FX) et
 * transition d'entrée (l'image précédente reste dessous pendant la
 * transition). Les styles sont appliqués directement au DOM à chaque image,
 * sans re-rendu React.
 */
export default function EffectVisual({ clip, clips, tracks, time, subscribe, videoRef, videoProps }: EffectVisualProps) {
  const inRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const outZoomRef = useRef<HTMLDivElement>(null);

  // Ce qui était à l'écran juste avant le clip (null = noir)
  const from = useMemo(() => {
    if (!clip.transition) return null;
    const before = findActiveVisual(clips, tracks, clip.start - 0.5);
    return before && before.id !== clip.id && before.src ? before : null;
  }, [clip, clips, tracks]);

  const apply = useCallback((timePx: number) => {
    const zoomEl = zoomRef.current;
    if (zoomEl) {
      const z = zoomScaleAt(clip, timePx);
      zoomEl.style.transform = z === 1 ? '' : `scale(${z.toFixed(5)})`;
    }
    const inEl = inRef.current;
    const outEl = outRef.current;
    const state = transitionAt(clip, clips, tracks, timePx);
    if (!inEl) return;
    if (!state) {
      inEl.style.opacity = '';
      inEl.style.clipPath = '';
      inEl.style.transform = '';
      if (outEl) outEl.style.display = 'none';
      return;
    }
    const { incoming, outgoing } = transitionStyles(state.type, state.progress);
    inEl.style.opacity = String(incoming.opacity);
    inEl.style.clipPath = incoming.clipPath === 'none' ? '' : incoming.clipPath;
    inEl.style.transform = incoming.transform === 'none' ? '' : incoming.transform;
    if (outEl) {
      outEl.style.display = '';
      outEl.style.opacity = String(outgoing.opacity);
    }
    const outZoomEl = outZoomRef.current;
    if (outZoomEl && from) {
      // L'image précédente reste figée sur sa dernière image (zoom compris)
      const z = zoomScaleAt(from, clipEnd(from));
      outZoomEl.style.transform = z === 1 ? '' : `scale(${z.toFixed(5)})`;
    }
  }, [clip, clips, tracks, from]);

  useLayoutEffect(() => { apply(time); }, [apply, time]);
  useEffect(() => (subscribe ? subscribe(apply) : undefined), [subscribe, apply]);

  return (
    <>
      {from && (
        <div ref={outRef} className={LAYER} style={{ display: 'none' }} aria-hidden>
          <div ref={outZoomRef} className={LAYER}>
            {from.type === 'video' ? (
              <video
                src={from.src}
                muted
                playsInline
                preload="auto"
                className={MEDIA}
                style={{ transform: visualTransformCss(from) }}
                // Dernière image du clip précédent
                onLoadedMetadata={(e) => { e.currentTarget.currentTime = mediaTimeSec(from, clipEnd(from) - 1); }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={from.src} alt="" className={MEDIA} style={{ transform: visualTransformCss(from) }} />
            )}
          </div>
        </div>
      )}
      <div ref={inRef} className={LAYER}>
        <div ref={zoomRef} className={LAYER} style={{ transformOrigin: '50% 50%', willChange: 'transform' }}>
          {clip.type === 'video' ? (
            <video
              ref={videoRef}
              src={clip.src}
              playsInline
              preload="auto"
              {...videoProps}
              className={MEDIA}
              style={{ transform: visualTransformCss(clip), willChange: 'transform' }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clip.src} alt={clip.name} className={MEDIA} style={{ transform: visualTransformCss(clip) }} />
          )}
        </div>
      </div>
    </>
  );
}
