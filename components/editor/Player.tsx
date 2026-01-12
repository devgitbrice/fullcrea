"use client";

import { useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Video, Music, AlertCircle } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';

export default function Player() {
  const { isPlaying, togglePlay, currentTime, clips, setCurrentTime, scale, currentView } = useProject();
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const activeVideoClip = clips.find(
    (c) => c.track === 1 && currentTime >= c.start && currentTime < c.start + c.width
  );

  const activeAudioClip = clips.find(
    (c) => c.track === 2 && currentTime >= c.start && currentTime < c.start + c.width
  );

  const isVideoMode = currentView === 'video';

  // --- MOTEUR DE SYNCHRONISATION VIDÉO ---
  useEffect(() => {
    if (activeVideoClip && videoRef.current) {
      const targetTime = (currentTime - activeVideoClip.start) / scale;
      const diff = Math.abs(videoRef.current.currentTime - targetTime);

      if (isPlaying) {
        if (diff > 0.2) videoRef.current.currentTime = targetTime;
        // On vérifie activeVideoClip.src pour éviter l'erreur sur une vidéo vide
        if (videoRef.current.paused && activeVideoClip.src) {
             videoRef.current.play().catch(() => {});
        }
      } else {
        if (diff > 0.05) videoRef.current.currentTime = targetTime;
        videoRef.current.pause();
      }
    }
  }, [currentTime, isPlaying, activeVideoClip, scale]);

  // --- MOTEUR DE SYNCHRONISATION AUDIO (CORRIGÉ) ---
  useEffect(() => {
    // CRUCIAL : On ajoute '&& activeAudioClip.src' pour ne pas essayer de lire du vide
    if (activeAudioClip && activeAudioClip.src && audioRef.current) {
      
      const targetTime = (currentTime - activeAudioClip.start) / scale;
      const diff = Math.abs(audioRef.current.currentTime - targetTime);

      if (isPlaying) {
        if (diff > 0.2) audioRef.current.currentTime = targetTime;
        
        if (audioRef.current.paused) {
            // Le catch est important pour intercepter les erreurs de lecture
            audioRef.current.play().catch((e) => console.log("Lecture audio impossible (source vide ?)", e));
        }
      } else {
        if (diff > 0.05) audioRef.current.currentTime = targetTime;
        audioRef.current.pause();
      }
    } 
    else if (audioRef.current) {
        // Si plus de clip ou source vide, on coupe le son
        audioRef.current.pause();
    }
  }, [currentTime, isPlaying, activeAudioClip, scale]);


  const formatTime = (px: number) => {
    const totalSeconds = Math.floor(px / scale);
    const date = new Date(0);
    date.setSeconds(totalSeconds);
    return date.toISOString().substr(11, 8);
  };

  const handleSeek = (direction: 'forward' | 'backward') => {
    setCurrentTime((prev) => {
      const delta = direction === 'forward' ? scale : -scale;
      return Math.max(0, prev + delta);
    });
  };

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