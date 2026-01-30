"use client";

import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Video, Music, AlertCircle } from 'lucide-react';
import { useProject, Clip } from '@/components/ProjectContext';

export default function Player() {
  const { isPlaying, togglePlay, currentTime, clips, setCurrentTime, scale, currentView, subscribeToTime, currentTimeRef } = useProject();

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // ✅ Cache pour éviter les recherches répétées de clips
  const lastVideoClipRef = useRef<Clip | null>(null);
  const lastAudioClipRef = useRef<Clip | null>(null);

  // ✅ Mémoriser les clips actifs (pour l'affichage UI uniquement)
  const activeVideoClip = useMemo(() => {
    return clips.find(
      (c) => c.track === 1 && currentTime >= c.start && currentTime < c.start + c.width
    ) || null;
  }, [clips, currentTime]);

  const activeAudioClip = useMemo(() => {
    return clips.find(
      (c) => c.track === 2 && currentTime >= c.start && currentTime < c.start + c.width
    ) || null;
  }, [clips, currentTime]);

  const isVideoMode = currentView === 'video';

  // ✅ Fonction de recherche de clip optimisée (inline, pas de state)
  const findClipAtTime = useCallback((time: number, track: 1 | 2): Clip | null => {
    return clips.find(
      (c) => c.track === track && time >= c.start && time < c.start + c.width
    ) || null;
  }, [clips]);

  // --- MOTEUR DE SYNCHRONISATION VIDÉO/AUDIO OPTIMISÉ ---
  useEffect(() => {
    // S'abonner aux mises à jour de temps haute fréquence
    const unsubscribe = subscribeToTime((time) => {
      // Synchronisation VIDÉO
      const videoClip = findClipAtTime(time, 1);
      if (videoClip && videoRef.current) {
        const targetTime = (time - videoClip.start) / scale;
        const diff = Math.abs(videoRef.current.currentTime - targetTime);

        if (isPlaying) {
          // Resync seulement si décalage important
          if (diff > 0.3) videoRef.current.currentTime = targetTime;
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
        const targetTime = (time - audioClip.start) / scale;
        const diff = Math.abs(audioRef.current.currentTime - targetTime);

        if (isPlaying) {
          if (diff > 0.3) audioRef.current.currentTime = targetTime;
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
  }, [subscribeToTime, findClipAtTime, scale, isPlaying]);

  // Gérer pause/play
  useEffect(() => {
    if (!isPlaying) {
      videoRef.current?.pause();
      audioRef.current?.pause();
    }
  }, [isPlaying]);


  // ✅ Mémoriser formatTime
  const formatTime = useCallback((px: number) => {
    const totalSeconds = Math.floor(px / scale);
    const date = new Date(0);
    date.setSeconds(totalSeconds);
    return date.toISOString().substr(11, 8);
  }, [scale]);

  // ✅ Mémoriser handleSeek
  const handleSeek = useCallback((direction: 'forward' | 'backward') => {
    setCurrentTime((prev) => {
      const delta = direction === 'forward' ? scale : -scale;
      return Math.max(0, prev + delta);
    });
  }, [scale, setCurrentTime]);

  return (
    <div className={`flex flex-col h-full bg-black text-white border-l border-gray-800 relative z-0 ${!isVideoMode ? 'justify-end' : ''}`}>
      
      {/* ÉCRAN VISUEL (Seulement en mode Vidéo) */}
      {isVideoMode && (
        <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 p-6 overflow-hidden relative z-0">
            <div className="aspect-video w-full max-w-3xl bg-black shadow-2xl flex items-center justify-center relative overflow-hidden border border-gray-800 rounded-sm z-0">
            
            {activeVideoClip ? (
                <div className="w-full h-full relative bg-gray-800">
                {activeVideoClip.src ? (
                    activeVideoClip.type === 'video' ? (
                    <video
                        ref={videoRef}
                        src={activeVideoClip.src}
                        className="w-full h-full object-contain"
                        muted={false} 
                    />
                    ) : (
                    <img 
                        src={activeVideoClip.src} 
                        alt={activeVideoClip.name} 
                        className="w-full h-full object-contain"
                    />
                    )
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10">
                    <AlertCircle size={48} className="mb-4 text-red-500" />
                    <p className="text-sm text-red-400">Source manquante</p>
                    </div>
                )}
                </div>
            ) : (
                <div className="flex flex-col items-center gap-3 opacity-50">
                    {activeAudioClip ? (
                        <>
                            <Music size={48} className="text-green-500 animate-pulse" />
                            <span className="text-sm font-mono text-green-400">{activeAudioClip.name}</span>
                        </>
                    ) : (
                        <div className="w-16 h-16 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center">
                            <Play size={24} className="ml-1 text-gray-600" />
                        </div>
                    )}
                </div>
            )}

            {/* Overlay REC */}
            {isPlaying && (
                <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full backdrop-blur-md pointer-events-none">
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
        <div className="w-24 font-mono text-blue-400 text-sm font-medium">
          {formatTime(currentTime)}
        </div>

        <div className="flex items-center gap-6">
          <button onClick={() => handleSeek('backward')} className="text-gray-400 hover:text-white transition active:scale-90">
            <SkipBack size={20} />
          </button>

          <button 
            onClick={togglePlay}
            className={`
              w-12 h-12 flex items-center justify-center rounded-full text-white shadow-lg transition-all transform active:scale-95
              ${isPlaying ? 'bg-red-600 hover:bg-red-500' : 'bg-white text-black hover:bg-gray-200'}
            `}
          >
            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
          </button>

          <button onClick={() => handleSeek('forward')} className="text-gray-400 hover:text-white transition active:scale-90">
            <SkipForward size={20} />
          </button>
        </div>
        
        <div className="w-24"></div>
      </div>
    </div>
  );
}