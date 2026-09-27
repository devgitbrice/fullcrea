"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Maximize2, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import type { Clip, ProjectSettings, Sequence, Track } from '@/lib/timeline/types';
import { PX_PER_SEC_BASE } from '@/lib/timeline/types';
import {
  clipEnd, findActiveAudioOnTrack, findActiveVisual, flattenClips, mediaTimeSec,
  clipSpeed, clipGain, audibleTrackIds,
} from '@/lib/timeline/clipOps';
import { defaultImageTransform } from '@/components/ProjectContext';
import StageFrame from '@/components/StageFrame';
import TextClips from '@/components/TextClips';
import EffectVisual, { type TimeSubscribe } from '@/components/EffectVisual';

// Resynchronise un média quand il dérive de plus d'un tiers de seconde
const SYNC_THRESHOLD_SEC = 0.35;
// La barre de progression n'a pas besoin de 60 images par seconde
const UI_REFRESH_MS = 80;
// Pas des flèches ← → au clavier
const SEEK_STEP_SEC = 5;

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Lance un média. Si le navigateur refuse le son (lecture demandée sans geste
 * dans ce cadre, ex. barre d'espace transmise par la page Muxeo), on continue
 * sans le son — image et temps restent synchronisés — et on le signale pour
 * proposer « Activer le son ».
 */
function playOrMute(el: HTMLMediaElement, onBlocked: () => void) {
  el.play().catch((err: unknown) => {
    if ((err as { name?: string })?.name !== 'NotAllowedError' || el.muted) return;
    onBlocked();
    el.muted = true;
    el.play().catch(() => {});
  });
}

/** Une piste audio = un élément <audio>, comme dans l'éditeur. */
function TrackAudio({ track, clips, playing, muted, volume, timeRef, onBlocked }: {
  track: Track; clips: Clip[]; playing: boolean; muted: boolean; volume: number;
  timeRef: React.MutableRefObject<number>; onBlocked: () => void;
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
        const gain = muted || track.muted ? 0 : clipGain(clip, timeRef.current) * volume;
        if (Math.abs(el.volume - gain) > 0.01) el.volume = Math.min(1, Math.max(0, gain));
        const speed = clipSpeed(clip);
        if (el.playbackRate !== speed) el.playbackRate = speed;
        const target = mediaTimeSec(clip, timeRef.current);
        if (Math.abs(el.currentTime - target) > SYNC_THRESHOLD_SEC) el.currentTime = target;
        if (playing && el.paused) playOrMute(el, onBlocked);
        if (!playing && !el.paused) el.pause();
      } else if (el && !el.paused) {
        el.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clips, track.id, playing, muted, volume, track.muted, timeRef, onBlocked]);

  // Volume piloté image par image (fondus) ; ici seulement le muet
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted || !!active?.muted || !!track.muted;
  }, [active?.muted, muted, track.muted]);

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
  const audioTracks = useMemo(() => {
    const audible = audibleTrackIds(tracks);
    return tracks.filter(t => audible.has(t.id));
  }, [tracks]);

  const durationPx = useMemo(() => clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0), [clips]);
  const durationSec = durationPx / PX_PER_SEC_BASE;

  const videoRef = useRef<HTMLVideoElement>(null);
  const timeRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastUiRef = useRef(0);
  // Abonnés à l'horloge image par image (zoom et transitions fluides)
  const frameSubsRef = useRef(new Set<(t: number) => void>());
  const subscribe = useCallback<TimeSubscribe>((cb) => {
    frameSubsRef.current.add(cb);
    return () => { frameSubsRef.current.delete(cb); };
  }, []);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  // Volume général du lecteur (0..1), réglé au survol du haut-parleur
  const [volume, setVolume] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  // Son refusé par le navigateur : lecture muette + bouton « Activer le son »
  const [soundBlocked, setSoundBlocked] = useState(false);
  const onBlocked = useCallback(() => setSoundBlocked(true), []);
  const effectiveMuted = muted || soundBlocked;

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
      frameSubsRef.current.forEach(cb => cb(next));
      if (now - lastUiRef.current > UI_REFRESH_MS) {
        lastUiRef.current = now;
        setTime(next);
      }
      const el = videoRef.current;
      const clip = findActiveVisual(clips, tracks, next);
      if (el && clip?.type === 'video' && clip.src) {
        const speed = clipSpeed(clip);
        if (el.playbackRate !== speed) el.playbackRate = speed;
        const gain = muted ? 0 : clipGain(clip, next) * volume;
        if (Math.abs(el.volume - gain) > 0.01) el.volume = Math.min(1, Math.max(0, gain));
        const target = mediaTimeSec(clip, next);
        if (Math.abs(el.currentTime - target) > SYNC_THRESHOLD_SEC) el.currentTime = target;
        if (el.paused) playOrMute(el, onBlocked);
      } else if (el && !el.paused) {
        el.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationPx, clips, tracks, muted, volume, onBlocked]);

  useEffect(() => {
    if (!playing) videoRef.current?.pause();
  }, [playing]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = effectiveMuted || !!activeVisual?.muted || !!tracks.find(t => t.id === activeVisual?.track)?.muted;
  }, [activeVisual?.id, activeVisual?.muted, activeVisual?.track, effectiveMuted, tracks]);

  // Nouveau clip vidéo : on se replace au bon endroit de la source
  const handleLoadedMetadata = () => {
    const el = videoRef.current;
    if (!el || activeVisual?.type !== 'video') return;
    el.currentTime = mediaTimeSec(activeVisual, timeRef.current);
    if (playing) el.play().catch(() => {});
  };

  const togglePlay = () => {
    if (!playing) {
      if (timeRef.current >= durationPx) seek(0);
      // Médias lancés pendant le geste (clic, Espace) : Safari et Chrome
      // n'autorisent le son que dans ce cas ; la boucle de lecture remet
      // ensuite chaque élément à la bonne position ou en pause.
      containerRef.current?.querySelectorAll<HTMLMediaElement>('audio[src], video[src]')
        .forEach(el => playOrMute(el, onBlocked));
    }
    setPlaying(p => !p);
  };

  // Clic sur « Activer le son » (geste dans ce cadre) : le son est autorisé
  const enableSound = () => {
    setSoundBlocked(false);
    containerRef.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach(el => {
      el.muted = muted;
      if (playing && el.src) el.play().catch(() => {});
    });
  };

  // Barre d'espace = lecture / pause, dans le lecteur ou depuis la page qui
  // l'intègre (Muxeo envoie { type: 'cut:toggle-play' } par postMessage)
  // Flèches ← → : reculer / avancer de 5 s (aussi par postMessage 'cut:seek')
  const togglePlayRef = useRef(togglePlay);
  const seekByRef = useRef((deltaSec: number) => seek(timeRef.current + deltaSec * PX_PER_SEC_BASE));
  useEffect(() => {
    togglePlayRef.current = togglePlay;
    seekByRef.current = (deltaSec: number) => seek(timeRef.current + deltaSec * PX_PER_SEC_BASE);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'Space') {
        if (e.repeat) return;
        e.preventDefault();
        togglePlayRef.current();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seekByRef.current(e.key === 'ArrowLeft' ? -SEEK_STEP_SEC : SEEK_STEP_SEC);
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'cut:toggle-play') togglePlayRef.current();
      if (e.data.type === 'cut:seek' && typeof e.data.seconds === 'number') seekByRef.current(e.data.seconds);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
    };
  }, []);

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
        style={{ aspectRatio: `${settings.width} / ${settings.height}` }}
      >
        {/* Scène composée en pixels projet : même géométrie qu'à l'export */}
        <StageFrame settings={settings}>
          {activeVisual?.src && (
            <EffectVisual
              clip={activeVisual}
              clips={clips}
              tracks={tracks}
              time={time}
              subscribe={subscribe}
              videoRef={videoRef}
              videoProps={{ onLoadedMetadata: handleLoadedMetadata }}
            />
          )}
          <TextClips texts={activeTexts} />
        </StageFrame>

        {soundBlocked && !muted && (
          <button
            type="button"
            onClick={enableSound}
            className="absolute top-2 right-2 z-20 flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black shadow-lg hover:bg-gray-200 transition"
          >
            <VolumeX size={14} /> Activer le son
          </button>
        )}

        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-700 text-xs">
            Cette timeline est vide
          </div>
        )}

        {/* Pistes audio : un élément par piste (voix off, musique, micro…) */}
        {audioTracks.map(track => (
          <TrackAudio
            key={track.id}
            track={track}
            clips={clips}
            playing={playing}
            muted={effectiveMuted}
            volume={volume}
            timeRef={timeRef}
            onBlocked={onBlocked}
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

        {/* Haut-parleur : clic = couper / rétablir ; survol = réglage du volume */}
        <div className="group/vol shrink-0 flex items-center">
          <button
            type="button"
            onClick={() => setMuted(m => !m)}
            aria-label={muted ? 'Rétablir le son' : 'Couper le son'}
            aria-pressed={muted}
            className="shrink-0 p-1.5 rounded text-gray-400 hover:text-white transition"
          >
            {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <div className="w-0 opacity-0 overflow-hidden transition-all duration-200 group-hover/vol:w-24 group-hover/vol:opacity-100 group-focus-within/vol:w-24 group-focus-within/vol:opacity-100">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={muted ? 0 : Math.round(volume * 100)}
              onChange={(e) => {
                const next = Number(e.target.value) / 100;
                setVolume(next);
                setMuted(next === 0);
              }}
              aria-label="Volume"
              className="w-20 h-1 mx-1 cursor-pointer accent-white"
            />
          </div>
        </div>

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
