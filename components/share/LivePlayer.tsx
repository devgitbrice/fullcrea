"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Maximize2, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import type { Clip, ProjectSettings, Sequence, Track } from '@/lib/timeline/types';
import { PX_PER_SEC_BASE } from '@/lib/timeline/types';
import {
  clipEnd, findActiveAudioOnTrack, findActiveVisual, flattenClips, mediaTimeSec,
} from '@/lib/timeline/clipOps';
import { defaultImageTransform } from '@/components/ProjectContext';

// Resynchronise un média quand il dérive de plus d'un tiers de seconde
const SYNC_THRESHOLD_SEC = 0.35;
// La barre de progression n'a pas besoin de 60 images par seconde
const UI_REFRESH_MS = 80;

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function transformStyle(clip: Clip) {
  const t = clip.transform || defaultImageTransform;
  return {
    transform: `translate(${t.positionX}px, ${t.positionY}px) rotateX(${t.rotationX}deg) rotateY(${t.rotationY}deg) rotateZ(${t.rotationZ || 0}deg) scaleX(${t.scaleX}) scaleY(${t.scaleY})`,
    transformOrigin: 'center center',
    transformStyle: 'preserve-3d' as const,
  };
}

/** Une piste audio = un élément <audio>, comme dans l'éditeur. */
function TrackAudio({ track, clips, playing, muted, timeRef }: {
  track: Track; clips: Clip[]; playing: boolean; muted: boolean; timeRef: React.MutableRefObject<number>;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = useMemo(
    () => clips.find(c => c.id === activeId) ?? null,
    [clips, activeId]
  );

  // Le clip actif est relu sur l'horloge du lecteur, pas sur un état React
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const clip = findActiveAudioOnTrack(clips, track.id, timeRef.current);
      setActiveId(prev => (clip?.id ?? null) === prev ? prev : (clip?.id ?? null));
      const el = ref.current;
      if (el && clip?.src) {
        const target = mediaTimeSec(clip, timeRef.current);
        if (Math.abs(el.currentTime - target) > SYNC_THRESHOLD_SEC) el.currentTime = target;
        if (playing && el.paused) el.play().catch(() => {});
        if (!playing && !el.paused) el.pause();
      } else if (el && !el.paused) {
        el.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clips, track.id, playing, timeRef]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, active?.volume ?? 1));
    el.muted = muted || !!active?.muted || !!track.muted;
  }, [active?.volume, active?.muted, muted, track.muted]);

  return <audio ref={ref} src={active?.src || undefined} preload="auto" />;
}

interface LivePlayerProps {
  sequences: Sequence[];
  sequenceId: string;
  settings: ProjectSettings;
  /** Mode intégration : lecteur plein cadre, sans marges */
  bare?: boolean;
}

/**
 * Lecteur autonome d'un montage : rejoue une timeline (clips vidéo, images,
 * textes et pistes audio) sans dépendre de l'éditeur. Utilisé par les pages
 * publiques de partage, où le montage est relu à chaque sauvegarde du projet.
 */
export default function LivePlayer({ sequences, sequenceId, settings, bare = false }: LivePlayerProps) {
  const sequence = useMemo(
    () => sequences.find(s => s.id === sequenceId) ?? sequences[0],
    [sequences, sequenceId]
  );

  // Timelines imbriquées dépliées : le lecteur ne voit que des clips ordinaires
  const clips = useMemo(
    () => (sequence ? flattenClips(sequence.clips, sequences) : []),
    [sequence, sequences]
  );
  const tracks = useMemo(() => {
    const seen = new Set<number>();
    const out: Track[] = [];
    for (const s of sequences) for (const t of s.tracks) if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
    return out;
  }, [sequences]);
  const audioTracks = useMemo(() => tracks.filter(t => t.type === 'audio' && !t.muted), [tracks]);

  const durationPx = useMemo(() => clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0), [clips]);
  const durationSec = durationPx / PX_PER_SEC_BASE;

  const videoRef = useRef<HTMLVideoElement>(null);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastUiRef = useRef(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeVisual = useMemo(() => findActiveVisual(clips, tracks, time), [clips, tracks, time]);
  const activeTexts = useMemo(
    () => clips.filter(c => c.type === 'text' && time >= c.start && time < clipEnd(c)),
    [clips, time]
  );

  const seek = useCallback((px: number) => {
    const next = Math.min(Math.max(0, px), durationPx);
    timeRef.current = next;
    setTime(next);
    const el = videoRef.current;
    const clip = findActiveVisual(clips, tracks, next);
    if (el && clip?.type === 'video' && clip.src) el.currentTime = mediaTimeSec(clip, next);
  }, [durationPx, clips, tracks]);

  // Horloge du lecteur : avance le temps et resynchronise la vidéo
  useEffect(() => {
    if (!playing) return;
    lastFrameRef.current = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const deltaSec = (now - lastFrameRef.current) / 1000;
      lastFrameRef.current = now;
      const next = timeRef.current + deltaSec * PX_PER_SEC_BASE;
      if (next >= durationPx) {
        timeRef.current = durationPx;
        setTime(durationPx);
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      if (now - lastUiRef.current > UI_REFRESH_MS) {
        lastUiRef.current = now;
        setTime(next);
      }
      const el = videoRef.current;
      const clip = findActiveVisual(clips, tracks, next);
      if (el && clip?.type === 'video' && clip.src) {
        const target = mediaTimeSec(clip, next);
        if (Math.abs(el.currentTime - target) > SYNC_THRESHOLD_SEC) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else if (el && !el.paused) {
        el.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationPx, clips, tracks]);

  useEffect(() => {
    if (!playing) videoRef.current?.pause();
  }, [playing]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = Math.min(1, Math.max(0, activeVisual?.volume ?? 1));
    el.muted = muted || !!activeVisual?.muted || !!tracks.find(t => t.id === activeVisual?.track)?.muted;
  }, [activeVisual?.id, activeVisual?.volume, activeVisual?.muted, activeVisual?.track, muted, tracks]);

  // Nouveau clip vidéo : on se replace au bon endroit de la source
  const handleLoadedMetadata = () => {
    const el = videoRef.current;
    if (!el || activeVisual?.type !== 'video') return;
    el.currentTime = mediaTimeSec(activeVisual, timeRef.current);
    if (playing) el.play().catch(() => {});
  };

  const togglePlay = () => {
    if (!playing && timeRef.current >= durationPx) seek(0);
    setPlaying(p => !p);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const progress = durationPx > 0 ? Math.min(1, time / durationPx) : 0;
  const empty = clips.length === 0;

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col bg-black ${bare ? 'w-full h-full' : 'w-full rounded-lg overflow-hidden shadow-2xl'}`}
    >
      {/* Scène */}
      <div
        className="relative w-full bg-black overflow-hidden"
        // containerType : les textes se mettent à l'échelle de l'aperçu (unités cqw)
        style={{ aspectRatio: `${settings.width} / ${settings.height}`, containerType: 'inline-size' }}
      >
        {activeVisual?.src ? (
          activeVisual.type === 'video' ? (
            <video
              ref={videoRef}
              src={activeVisual.src}
              onLoadedMetadata={handleLoadedMetadata}
              playsInline
              preload="auto"
              className="w-full h-full object-contain"
              style={transformStyle(activeVisual)}
            />
          ) : (
            <img
              src={activeVisual.src}
              alt={activeVisual.name}
              className="w-full h-full object-contain"
              style={transformStyle(activeVisual)}
            />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-700 text-xs">
            {empty ? 'Cette timeline est vide' : ''}
          </div>
        )}

        {/* Textes en surimpression */}
        {activeTexts.map(t => (
          <div key={t.id} className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span
              style={{
                fontSize: `${((t.fontSize || 48) / settings.width) * 100}cqw`,
                fontFamily: t.fontFamily || 'Arial',
                color: t.textColor || '#ffffff',
                textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                whiteSpace: 'pre-wrap',
                textAlign: 'center',
                maxWidth: '90%',
              }}
            >
              {t.text || 'Texte'}
            </span>
          </div>
        ))}

        {/* Pistes audio : un élément par piste (voix off, musique, micro…) */}
        {audioTracks.map(track => (
          <TrackAudio
            key={track.id}
            track={track}
            clips={clips}
            playing={playing}
            muted={muted}
            timeRef={timeRef}
          />
        ))}
      </div>

      {/* Contrôles */}
      <div className="shrink-0 bg-gray-950/95 border-t border-gray-800 px-3 py-2 flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={empty}
          aria-label={playing ? 'Pause' : 'Lecture'}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-white hover:bg-gray-200 disabled:opacity-40 text-black transition"
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>

        <button
          type="button"
          onClick={() => seek(0)}
          disabled={empty}
          aria-label="Revenir au début"
          className="shrink-0 p-1.5 rounded text-gray-400 hover:text-white transition disabled:opacity-40"
        >
          <RotateCcw size={15} />
        </button>

        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(durationPx))}
          value={Math.round(time)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={empty}
          aria-label="Position de lecture"
          className="flex-1 min-w-0 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500 disabled:opacity-40"
          style={{ background: `linear-gradient(to right, rgb(249 115 22) ${progress * 100}%, rgb(55 65 81) ${progress * 100}%)` }}
        />

        <span className="shrink-0 text-[11px] font-mono text-gray-400 tabular-nums">
          {formatTime(time / PX_PER_SEC_BASE)} / {formatTime(durationSec)}
        </span>

        <button
          type="button"
          onClick={() => setMuted(m => !m)}
          aria-label={muted ? 'Rétablir le son' : 'Couper le son'}
          aria-pressed={muted}
          className="shrink-0 p-1.5 rounded text-gray-400 hover:text-white transition"
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label="Plein écran"
          className="shrink-0 p-1.5 rounded text-gray-400 hover:text-white transition"
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
