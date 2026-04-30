"use client";

import { useEffect, useRef, useState } from 'react';

// Cache module-level pour éviter de re-décoder la même piste audio
type Peaks = { peaks: Float32Array; duration: number };
const peaksCache = new Map<string, Peaks>();
const inflight = new Map<string, Promise<Peaks>>();

const PEAK_RESOLUTION = 1500; // Nombre de pics calculés sur la durée totale du fichier audio

async function loadPeaks(src: string): Promise<Peaks> {
  const cached = peaksCache.get(src);
  if (cached) return cached;
  const pending = inflight.get(src);
  if (pending) return pending;

  const promise = (async () => {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) throw new Error('AudioContext indisponible');
    const ctx = new AudioCtx();
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buf = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(buf);
      const channelData = audioBuffer.getChannelData(0);
      const samplesPerPeak = Math.max(1, Math.floor(channelData.length / PEAK_RESOLUTION));
      const peaks = new Float32Array(PEAK_RESOLUTION);
      for (let i = 0; i < PEAK_RESOLUTION; i++) {
        const start = i * samplesPerPeak;
        const end = Math.min(start + samplesPerPeak, channelData.length);
        let max = 0;
        for (let j = start; j < end; j++) {
          const v = Math.abs(channelData[j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      const result: Peaks = { peaks, duration: audioBuffer.duration };
      peaksCache.set(src, result);
      return result;
    } finally {
      ctx.close().catch(() => {});
      inflight.delete(src);
    }
  })();

  inflight.set(src, promise);
  return promise;
}

interface Props {
  src: string;
  durationSeconds: number; // Durée du clip à afficher (peut être < durée totale du fichier source)
  color?: string;
  className?: string;
}

export default function AudioWaveform({ src, durationSeconds, color = 'rgba(134, 239, 172, 0.85)', className = '' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Peaks | null>(null);
  const [error, setError] = useState(false);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Charger les pics
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    setError(false);
    setData(null);
    loadPeaks(src)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [src]);

  // Observer la taille du container pour redessiner si le clip est zoomé/redimensionné
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Dessiner la waveform
  useEffect(() => {
    if (!data || !canvasRef.current || containerSize.w === 0 || containerSize.h === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = containerSize.w;
    const cssH = containerSize.h;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    // Portion des pics à afficher = ratio entre la durée du clip et la durée totale du fichier source
    const ratio = data.duration > 0 ? Math.min(1, durationSeconds / data.duration) : 1;
    const peaksToShow = Math.max(1, Math.floor(data.peaks.length * ratio));
    const samplesPerPx = peaksToShow / cssW;
    const mid = cssH / 2;

    ctx.fillStyle = color;
    for (let x = 0; x < cssW; x++) {
      const startIdx = Math.floor(x * samplesPerPx);
      const endIdx = Math.min(peaksToShow, Math.floor((x + 1) * samplesPerPx) + 1);
      let max = 0;
      for (let i = startIdx; i < endIdx; i++) {
        if (data.peaks[i] > max) max = data.peaks[i];
      }
      const h = Math.max(1, max * (cssH - 2));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [data, durationSeconds, color, containerSize]);

  return (
    <div ref={containerRef} className={`absolute inset-0 pointer-events-none ${className}`}>
      {!error && <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />}
    </div>
  );
}
