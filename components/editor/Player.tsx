"use client";

import { shouldIgnoreShortcut } from '@/lib/keyboard';
import {
  useRef, useEffect, useMemo, useCallback, useState,
  PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Play, Pause, SkipBack, SkipForward, StepBack, StepForward, Repeat, Music, AlertCircle } from 'lucide-react';
import { useProject, Clip, defaultImageTransform } from '@/components/ProjectContext';

// Clips et currentTime sont exprimés en px à zoom 1 (30 px = 1 s), indépendamment du zoom.
const PX_PER_SEC = 30;
const DEFAULT_FPS = 30;
// Absorbe le bruit flottant (31 / 30 * 30 = 30.999…) pour ne pas afficher l'image précédente
const EPSILON = 1e-6;

const pad2 = (n: number) => String(n).padStart(2, '0');

function formatTimecode(px: number, fps: number): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
  const seconds = (Number.isFinite(px) ? Math.max(0, px) : 0) / PX_PER_SEC;
  const totalFrames = Math.floor(seconds * safeFps + EPSILON);
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const frames = Math.floor(totalFrames - totalSeconds * safeFps);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}:${pad2(frames)}`;
}

const transportButtonClass =
  'p-1 rounded text-gray-400 hover:text-white transition active:scale-90 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:active:scale-100';

export default function Player() {
  const {
    isPlaying, togglePlay, currentTime, clips, setCurrentTime, currentView,
    subscribeToTime, currentTimeRef, projectSettings, projectDurationPx,
  } = useProject();

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // ✅ Cache pour éviter les recherches répétées de clips
  const lastVideoClipRef = useRef<Clip | null>(null);
  const lastAudioClipRef = useRef<Clip | null>(null);

  // ✅ Mémoriser les clips actifs (pour l'affichage UI uniquement)
  const activeVideoClip = useMemo(() => {
    return clips.find(
      (c) => (c.type === 'video' || c.type === 'image') && currentTime >= c.start && currentTime < c.start + c.width
    ) || null;
  }, [clips, currentTime]);

  const activeAudioClip = useMemo(() => {
    return clips.find(
      (c) => c.type === 'audio' && currentTime >= c.start && currentTime < c.start + c.width
    ) || null;
  }, [clips, currentTime]);

  // ✅ Mémoriser les clips texte actifs
  const activeTextClips = useMemo(() => {
    return clips.filter(
      (c) => c.type === 'text' && currentTime >= c.start && currentTime < c.start + c.width
    );
  }, [clips, currentTime]);

  const isVideoMode = currentView === 'video';

  // ✅ Fonction de recherche de clip optimisée (inline, pas de state)
  const findClipAtTime = useCallback((time: number, track: 1 | 2): Clip | null => {
    return clips.find(
      (c) => c.track === track && time >= c.start && time < c.start + c.width
    ) || null;
  }, [clips]);

  // --- MOTEUR DE SYNCHRONISATION VIDÉO/AUDIO OPTIMISÉ ---
  // ✅ Ref pour suivre le dernier temps de sync (évite les resyncs trop fréquents)
  const lastSyncTimeRef = useRef<number>(0);
  const SYNC_INTERVAL = 500; // Sync max toutes les 500ms
  const SYNC_THRESHOLD = 0.5; // Seuil de décalage en secondes
  const PAUSED_SEEK_THRESHOLD = 0.04; // ≈ 1 image à 25 fps

  useEffect(() => {
    // S'abonner aux mises à jour de temps haute fréquence
    const unsubscribe = subscribeToTime((time) => {
      const now = performance.now();
      const shouldSync = now - lastSyncTimeRef.current > SYNC_INTERVAL;

      // Synchronisation VIDÉO
      const videoClip = findClipAtTime(time, 1);
      if (videoClip && videoRef.current) {
        const targetTime = (time - videoClip.start) / PX_PER_SEC;
        const diff = Math.abs(videoRef.current.currentTime - targetTime);

        if (isPlaying) {
          // Resync seulement si décalage important ET intervalle respecté
          if (diff > SYNC_THRESHOLD && shouldSync) {
            videoRef.current.currentTime = targetTime;
            lastSyncTimeRef.current = now;
          }
          if (videoRef.current.paused && videoClip.src) {
            videoRef.current.play().catch(() => {});
          }
        }
        lastVideoClipRef.current = videoClip;
      } else if (lastVideoClipRef.current && videoRef.current) {
        // On sort du clip, mettre en pause
        videoRef.current.pause();
        lastVideoClipRef.current = null;
      }

      // Synchronisation AUDIO
      const audioClip = findClipAtTime(time, 2);
      if (audioClip && audioClip.src && audioRef.current) {
        const targetTime = (time - audioClip.start) / PX_PER_SEC;
        const diff = Math.abs(audioRef.current.currentTime - targetTime);

        if (isPlaying) {
          if (diff > SYNC_THRESHOLD && shouldSync) {
            audioRef.current.currentTime = targetTime;
            lastSyncTimeRef.current = now;
          }
          if (audioRef.current.paused) {
            audioRef.current.play().catch(() => {});
          }
        }
        lastAudioClipRef.current = audioClip;
      } else if (lastAudioClipRef.current && audioRef.current) {
        audioRef.current.pause();
        lastAudioClipRef.current = null;
      }
    });

    return unsubscribe;
  }, [subscribeToTime, findClipAtTime, isPlaying]);

  // Gérer pause/play
  useEffect(() => {
    if (!isPlaying) {
      videoRef.current?.pause();
      audioRef.current?.pause();
    }
  }, [isPlaying]);

  // En pause, les abonnés au temps ne sont pas notifiés : on suit currentTime
  // pour que le scrub et l'image par image affichent l'image exacte.
  useEffect(() => {
    if (isPlaying) return;
    const seek = (el: HTMLMediaElement | null, clip: Clip | null) => {
      if (!el || !clip || !clip.src) return;
      const target = (currentTime - clip.start) / PX_PER_SEC;
      if (Math.abs(el.currentTime - target) > PAUSED_SEEK_THRESHOLD) el.currentTime = target;
    };
    seek(videoRef.current, activeVideoClip?.type === 'video' ? activeVideoClip : null);
    seek(audioRef.current, activeAudioClip);
  }, [isPlaying, currentTime, activeVideoClip, activeAudioClip]);

  // --- TRANSPORT ---
  const fps = Number.isFinite(projectSettings.fps) && projectSettings.fps > 0 ? projectSettings.fps : DEFAULT_FPS;
  const frameStepPx = PX_PER_SEC / fps;
  const hasDuration = projectDurationPx > 0;

  // Le moteur de lecture ré-injecte currentTimeRef dans currentTime à la mise en
  // pause : on écrit la ref en premier pour que le saut ne soit pas écrasé.
  const seekTo = useCallback((px: number) => {
    const next = Math.max(0, px);
    currentTimeRef.current = next;
    setCurrentTime(next);
  }, [currentTimeRef, setCurrentTime]);

  const pauseAndSeek = useCallback((px: number) => {
    if (isPlaying) togglePlay();
    seekTo(px);
  }, [isPlaying, togglePlay, seekTo]);

  // Pas d'une image ou d'une seconde, toujours aligné sur la grille des images
  const step = useCallback((direction: 1 | -1, amountPx: number) => {
    const current = currentTimeRef.current;
    const onGrid = direction > 0
      ? Math.floor(current / frameStepPx + EPSILON) * frameStepPx
      : Math.ceil(current / frameStepPx - EPSILON) * frameStepPx;
    pauseAndSeek(onGrid + direction * amountPx);
  }, [currentTimeRef, frameStepPx, pauseAndSeek]);

  const jumpToStart = useCallback(() => pauseAndSeek(0), [pauseAndSeek]);
  const jumpToEnd = useCallback(() => pauseAndSeek(projectDurationPx), [pauseAndSeek, projectDurationPx]);

  // Relancer depuis le début quand on appuie sur Lecture en fin de projet
  const handleTogglePlay = useCallback(() => {
    if (!isPlaying && hasDuration && currentTimeRef.current >= projectDurationPx) {
      seekTo(0);
    }
    togglePlay();
  }, [isPlaying, hasDuration, currentTimeRef, projectDurationPx, seekTo, togglePlay]);

  // Clavier : ← → (image), Maj+← → (seconde), Début, Fin. Espace est géré par la Timeline.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (shouldIgnoreShortcut(e)) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          step(-1, e.shiftKey ? PX_PER_SEC : frameStepPx);
          break;
        case 'ArrowRight':
          e.preventDefault();
          step(1, e.shiftKey ? PX_PER_SEC : frameStepPx);
          break;
        case 'Home':
          e.preventDefault();
          jumpToStart();
          break;
        case 'End':
          e.preventDefault();
          jumpToEnd();
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, frameStepPx, jumpToStart, jumpToEnd]);

  // --- BOUCLE ---
  const [loop, setLoop] = useState(false);
  const wasPlayingRef = useRef(false);
  const loopRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Le provider coupe la lecture tout seul en fin de projet : on détecte le
  // passage lecture → pause avec la tête au-delà de la fin et on relance à 0.
  // Le redémarrage est différé d'une tâche pour passer APRÈS les effets du
  // provider, qui resynchronisent currentTime depuis currentTimeRef.
  useEffect(() => {
    if (isPlaying) {
      wasPlayingRef.current = true;
      return;
    }
    if (!wasPlayingRef.current) return;
    wasPlayingRef.current = false;
    if (!loop || !hasDuration || currentTimeRef.current < projectDurationPx) return;

    loopRestartRef.current = setTimeout(() => {
      loopRestartRef.current = null;
      seekTo(0);
      togglePlay();
    }, 0);
  }, [isPlaying, loop, hasDuration, projectDurationPx, currentTimeRef, seekTo, togglePlay]);

  useEffect(() => () => {
    if (loopRestartRef.current !== null) clearTimeout(loopRestartRef.current);
  }, []);

  // --- BARRE DE PROGRESSION ---
  const progressRatio = hasDuration ? Math.min(1, Math.max(0, currentTime / projectDurationPx)) : 0;

  const seekFromPointer = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    pauseAndSeek(ratio * projectDurationPx);
  }, [pauseAndSeek, projectDurationPx]);

  const handleProgressPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !hasDuration) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromPointer(e);
  };

  const handleProgressPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasDuration || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    seekFromPointer(e);
  };

  const handleProgressKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!hasDuration || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        step(-1, e.shiftKey ? PX_PER_SEC : frameStepPx);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        step(1, e.shiftKey ? PX_PER_SEC : frameStepPx);
        break;
      case 'PageDown':
        step(-1, PX_PER_SEC);
        break;
      case 'PageUp':
        step(1, PX_PER_SEC);
        break;
      case 'Home':
        jumpToStart();
        break;
      case 'End':
        jumpToEnd();
        break;
      default:
        return;
    }
    e.preventDefault();
    // Le listener global sur window gère déjà ces touches : éviter un double pas
    e.stopPropagation();
  };

  const currentTimecode = formatTimecode(currentTime, fps);
  const totalTimecode = formatTimecode(projectDurationPx, fps);

  return (
    <div className={`flex flex-col h-full bg-black text-white border-l border-gray-800 relative z-0 ${!isVideoMode ? 'justify-end' : ''}`}>

      {/* ÉCRAN VISUEL (Seulement en mode Vidéo) */}
      {isVideoMode && (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 p-6 overflow-hidden relative z-0">
            <div
              className="bg-black shadow-2xl flex items-center justify-center relative overflow-hidden border border-gray-800 rounded-sm z-0"
              style={{
                aspectRatio: `${projectSettings.width} / ${projectSettings.height}`,
                maxHeight: '100%',
                maxWidth: '100%',
                width: 'auto',
                height: '100%',
              }}
            >

            {activeVideoClip ? (
                <div className="w-full h-full relative bg-gray-800">
                {activeVideoClip.src ? (
                    activeVideoClip.type === 'video' ? (
                    <video
                        ref={videoRef}
                        src={activeVideoClip.src}
                        className="w-full h-full object-contain"
                        muted={false}
                        playsInline
                        preload="auto"
                        style={{ willChange: 'transform' }}
                    />
                    ) : (
                    (() => {
                      const t = activeVideoClip.transform || defaultImageTransform;
                      const transformStyle = {
                        transform: `
                          translate(${t.positionX}px, ${t.positionY}px)
                          rotateX(${t.rotationX}deg)
                          rotateY(${t.rotationY}deg)
                          rotateZ(${t.rotationZ || 0}deg)
                          scaleX(${t.scaleX})
                          scaleY(${t.scaleY})
                        `,
                        transformOrigin: 'center center',
                        transformStyle: 'preserve-3d' as const,
                      };
                      return (
                        <img
                          src={activeVideoClip.src}
                          alt={activeVideoClip.name}
                          className="w-full h-full object-contain transition-transform duration-100"
                          style={transformStyle}
                        />
                      );
                    })()
                    )
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10">
                    <AlertCircle size={48} className="mb-4 text-red-500" />
                    <p className="text-sm text-red-400">Source manquante</p>
                    </div>
                )}

                {/* Affichage des clips texte en superposition */}
                {activeTextClips.map(textClip => (
                  <div
                    key={textClip.id}
                    className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
                  >
                    <span
                      style={{
                        fontSize: `${textClip.fontSize || 48}px`,
                        fontFamily: textClip.fontFamily || 'Arial',
                        color: textClip.textColor || '#ffffff',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                        whiteSpace: 'pre-wrap',
                        textAlign: 'center',
                        maxWidth: '90%',
                      }}
                    >
                      {textClip.text || 'Texte'}
                    </span>
                  </div>
                ))}
                </div>
            ) : (
                <div className="flex flex-col items-center gap-3 opacity-50">
                    {activeAudioClip ? (
                        <>
                            <Music size={48} className="text-green-500 animate-pulse" />
                            <span className="text-sm font-mono text-green-400">{activeAudioClip.name}</span>
                        </>
                    ) : (
                        <div className="w-16 h-16 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center" aria-hidden="true">
                            <Play size={24} className="ml-1 text-gray-600" />
                        </div>
                    )}
                </div>
            )}

            {/* Overlay REC */}
            {isPlaying && (
                <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full backdrop-blur-md pointer-events-none" aria-hidden="true">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Play</span>
                </div>
            )}
            </div>
        </div>
      )}

      {/* LECTEUR AUDIO INVISIBLE */}
      <audio
          ref={audioRef}
          // 👇 LA CORRECTION MAGIQUE : Si src est "", on met undefined.
          // Le || undefined est crucial car React transforme src="" en attribut vide qui plante.
          src={activeAudioClip?.src || undefined}
          preload="auto"
      />

      {/* Mode Audio Simplifié */}
      {!isVideoMode && (
        <div className="flex-1 flex items-center justify-center bg-gray-950">
           <div className="text-gray-500 font-mono text-sm flex flex-col items-center gap-2">
              <Music size={48} className={`transition-all duration-300 ${isPlaying ? 'text-green-500 scale-110' : 'opacity-20'}`} />
              <span>{isPlaying ? 'Lecture Audio...' : 'Mode Audio - En Pause'}</span>
           </div>
        </div>
      )}

      {/* CONTRÔLES */}
      <div className="h-16 flex items-center justify-between bg-gray-950 border-t border-gray-800 px-6 select-none z-30 relative shrink-0">
        {/* Barre de progression : collée au bord haut, sans ajouter de hauteur
            (la vue podcast/musique ne laisse que 64 px au Player) */}
        <div
          role="slider"
          aria-label="Position de lecture"
          aria-valuemin={0}
          aria-valuemax={Math.round(projectDurationPx)}
          aria-valuenow={Math.round(Math.min(currentTime, projectDurationPx))}
          aria-valuetext={currentTimecode}
          aria-disabled={!hasDuration}
          tabIndex={hasDuration ? 0 : -1}
          className={`group absolute -top-1.5 left-0 right-0 h-2.5 z-10 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset ${hasDuration ? 'cursor-pointer' : 'cursor-default'}`}
          onPointerDown={handleProgressPointerDown}
          onPointerMove={handleProgressPointerMove}
          onKeyDown={handleProgressKeyDown}
        >
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 group-hover:bg-blue-500 transition-colors"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>
        </div>

        <div
          className="w-48 shrink min-w-0 overflow-hidden whitespace-nowrap font-mono text-xs tabular-nums"
          title="Position / Durée (HH:MM:SS:II)"
        >
          <span className="text-blue-400 font-medium">{currentTimecode}</span>
          <span className="text-gray-600 mx-1.5" aria-hidden="true">/</span>
          <span className="text-gray-500">{totalTimecode}</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={jumpToStart}
            disabled={currentTime <= 0}
            className={transportButtonClass}
            title="Début (Home)"
            aria-label="Début (Home)"
          >
            <SkipBack size={18} />
          </button>

          <button
            onClick={() => step(-1, frameStepPx)}
            disabled={currentTime <= 0}
            className={transportButtonClass}
            title="Image précédente (←)"
            aria-label="Image précédente (←)"
          >
            <StepBack size={18} />
          </button>

          <button
            onClick={handleTogglePlay}
            className={`
              w-12 h-12 flex items-center justify-center rounded-full shadow-lg transition-all transform active:scale-95
              ${isPlaying ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-white hover:bg-gray-200 text-black'}
            `}
            title="Lecture/Pause (Espace)"
            aria-label={isPlaying ? 'Pause' : 'Lecture'}
          >
            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="black" className="ml-1" />}
          </button>

          <button
            onClick={() => step(1, frameStepPx)}
            className={transportButtonClass}
            title="Image suivante (→)"
            aria-label="Image suivante (→)"
          >
            <StepForward size={18} />
          </button>

          <button
            onClick={jumpToEnd}
            disabled={!hasDuration}
            className={transportButtonClass}
            title="Fin (End)"
            aria-label="Fin (End)"
          >
            <SkipForward size={18} />
          </button>
        </div>

        <div className="w-48 shrink min-w-0 flex items-center justify-end">
          <button
            onClick={() => setLoop(prev => !prev)}
            aria-pressed={loop}
            className={`p-1.5 rounded transition-all duration-200 ${
              loop ? 'text-blue-400 bg-blue-600/10' : 'text-gray-500 hover:text-white hover:bg-gray-800'
            }`}
            title={loop ? 'Boucle activée' : 'Lire en boucle'}
            aria-label="Lire en boucle"
          >
            <Repeat size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
