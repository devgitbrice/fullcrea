"use client";

import { useRef, DragEvent, useState, useEffect, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, useCallback, useMemo } from 'react';
import { Music, Plus, Video, AudioLines, Type } from 'lucide-react';
import { useProject, Clip } from '@/components/ProjectContext';
import TimelineToolbar from './TimelineToolbar';
import AudioWaveform from './AudioWaveform';

const PX_PER_SEC_BASE = 30;

// --- Probe asynchrone de la durée d'un média ---
function probeMediaDuration(src: string, kind: 'video' | 'audio'): Promise<number | null> {
  return new Promise((resolve) => {
    const el = (kind === 'video' ? document.createElement('video') : document.createElement('audio')) as HTMLMediaElement;
    el.preload = 'metadata';
    el.muted = true;
    let done = false;
    const finish = (val: number | null) => {
      if (done) return;
      done = true;
      el.src = '';
      try { el.removeAttribute('src'); el.load(); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 8000);
    el.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      const d = el.duration;
      finish(isFinite(d) && d > 0 ? d : null);
    }, { once: true });
    el.addEventListener('error', () => { clearTimeout(timer); finish(null); }, { once: true });
    try { el.src = src; } catch { finish(null); }
  });
}

export default function Timeline() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  const {
    clips,
    setClips,
    currentTime,
    setCurrentTime,
    currentView,
    activeTool,
    setActiveTool,
    zoomLevel,
    setZoomLevel,
    selectedClipId,
    setSelectedClipId,
    togglePlay,
    subscribeToTime,
    currentTimeRef,
    tracks,
    addTrack,
    textTrackId,
  } = useProject();

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToTime((time) => {
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${time * zoomLevel}px)`;
      }
    });
    return unsubscribe;
  }, [subscribeToTime, zoomLevel]);

  // --- SNAPPING ---
  const SNAP_THRESHOLD = 10 / zoomLevel;
  const getSnappedPosition = useCallback((pos: number, excludeId?: string) => {
    let bestPos = pos;
    let minDiff = SNAP_THRESHOLD;
    const snapPoints = [currentTimeRef.current];
    clips.forEach(c => {
      if (c.id !== excludeId) {
        snapPoints.push(c.start);
        snapPoints.push(c.start + c.width);
      }
    });
    snapPoints.forEach(point => {
      const diff = Math.abs(pos - point);
      if (diff < minDiff) {
        minDiff = diff;
        bestPos = point;
      }
    });
    return bestPos;
  }, [clips, currentTimeRef, SNAP_THRESHOLD]);

  // --- CLAVIER : Suppression + Play/Pause ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target?.isContentEditable) return;

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        setClips(prev => prev.filter(c => c.id !== selectedClipId));
        setSelectedClipId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, setClips, setSelectedClipId, togglePlay]);

  // --- BLOCAGE ZOOM CHROME ---
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY * 0.001;
        setZoomLevel(prev => Math.min(Math.max(0.1, prev + delta), 10));
      }
    };
    el.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', handleWheelNative);
  }, [setZoomLevel]);

  // --- COUPE ---
  const handleClipClick = (e: ReactMouseEvent, clip: Clip) => {
    if (activeTool !== 'cut') return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cutPointX = (e.clientX - rect.left) / zoomLevel;
    const clipA: Clip = { ...clip, width: cutPointX, id: `${clip.id}_p1_${Date.now()}` };
    const clipB: Clip = { ...clip, id: `${clip.id}_p2_${Date.now()}`, start: clip.start + cutPointX, width: clip.width - cutPointX };
    setClips(prev => [...prev.filter(c => c.id !== clip.id), clipA, clipB]);
    setSelectedClipId(null);
  };

  // --- TRIM (Pointer Events : marche souris + touch + Apple Pencil) ---
  const handleTrim = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip, edge: 'start' | 'end') => {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const initialWidth = clip.width;
    const initialStart = clip.start;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = (moveEvent.clientX - startX) / zoomLevel;
      setClips(prev => prev.map(c => {
        if (c.id !== clip.id) return c;
        if (edge === 'end') {
          const newEnd = getSnappedPosition(initialStart + initialWidth + deltaX, clip.id);
          return { ...c, width: Math.max(5, newEnd - initialStart) };
        } else {
          const newStart = getSnappedPosition(initialStart + deltaX, clip.id);
          const newWidth = initialStart + initialWidth - newStart;
          return newWidth > 5 ? { ...c, start: newStart, width: newWidth } : c;
        }
      }));
    };
    const onUp = () => {
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  // --- DÉPLACEMENT DES CLIPS (Pointer Events) ---
  const handleClipPointerDown = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip) => {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const rect = target.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    setSelectedClipId(clip.id);
    setDraggingClipId(clip.id);

    let moved = false;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      if (!timelineRef.current) return;
      if (!moved) {
        const dx = Math.abs(moveEvent.clientX - startX);
        const dy = Math.abs(moveEvent.clientY - startY);
        if (dx < 3 && dy < 3) return; // seuil de mouvement (évite le drag accidentel sur tap)
        moved = true;
      }
      const timelineRect = timelineRef.current.getBoundingClientRect();
      const x = ((moveEvent.clientX - timelineRect.left) + timelineRef.current.scrollLeft - offsetX) / zoomLevel;
      const newStart = Math.max(0, x);
      setClips(prev => prev.map(c =>
        c.id === clip.id ? { ...c, start: newStart } : c
      ));
    };
    const onUp = () => {
      setDraggingClipId(null);
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  // --- CRÉATION CLIP TEXTE ---
  const handleAddTextClip = (clientX: number) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) + timelineRef.current.scrollLeft) / zoomLevel;
    const snappedStart = getSnappedPosition(x);

    const newClip: Clip = {
      id: `text_${Date.now()}`,
      name: 'Nouveau texte',
      type: 'text',
      track: textTrackId,
      start: Math.max(0, snappedStart),
      width: 150,
      src: '',
      text: 'Votre texte ici',
      fontSize: 48,
      fontFamily: 'Arial',
      textColor: '#ffffff'
    };

    setClips(prev => [...prev, newClip]);
    setSelectedClipId(newClip.id);
    setActiveTool('select');
  };

  // --- SCRUBBING (Pointer Events) ---
  const handleScrubPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // primary = left mouse / touch / pen tip — on rejette tout le reste
    if (e.button !== 0) return;
    if (draggingClipId) return;

    if (activeTool === 'text') {
      handleAddTextClip(e.clientX);
      return;
    }

    if (e.target === e.currentTarget) setSelectedClipId(null);
    setIsScrubbing(true);
    updateTimeFromCoord(e.clientX);

    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch {}

    const onMove = (moveEvent: PointerEvent) => updateTimeFromCoord(moveEvent.clientX);
    const onUp = () => {
      setIsScrubbing(false);
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };
  const updateTimeFromCoord = (clientX: number) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) + timelineRef.current.scrollLeft) / zoomLevel;
    setCurrentTime(Math.max(0, x));
  };

  // --- DRAG & DROP (HTML5 desktop) avec probe de durée ---
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const dropX = ((e.clientX - rect.left) + timelineRef.current.scrollLeft) / zoomLevel;
    const dataString = e.dataTransfer.getData("application/react-dnd");
    if (!dataString) return;
    const data = JSON.parse(dataString);

    const snappedStart = getSnappedPosition(dropX, data.isNew ? undefined : data.id);

    if (data.isNew) {
      const isVideo = data.type.startsWith('video');
      const isAudio = data.type.startsWith('audio');
      const clipType: Clip['type'] = isVideo ? 'video' : isAudio ? 'audio' : 'image';

      // Choisir une piste valide qui correspond au type
      const targetTrackType = isAudio ? 'audio' : 'video';
      const targetTrack = tracks.find(t => t.type === targetTrackType);
      if (!targetTrack) return;

      const newId = `clip_${Date.now()}`;
      const initialWidth = 150;
      const newClip: Clip = {
        id: newId,
        name: data.name,
        type: clipType,
        track: targetTrack.id,
        start: Math.max(0, snappedStart),
        width: initialWidth,
        src: data.src,
      };
      setClips(prev => [...prev, newClip]);

      // Probe la durée naturelle pour étirer le clip à sa vraie durée
      if (isVideo || isAudio) {
        probeMediaDuration(data.src, isVideo ? 'video' : 'audio').then(duration => {
          if (!duration) return;
          const naturalWidth = duration * PX_PER_SEC_BASE;
          setClips(prev => prev.map(c =>
            c.id === newId ? { ...c, width: naturalWidth } : c
          ));
        });
      }
    } else {
      setClips(prev => prev.map(c => c.id === data.id ? { ...c, start: Math.max(0, snappedStart) } : c));
    }
  };

  // --- STYLES & FILTRES ---
  const getClipStyle = useCallback((type: string) => {
    if (type === 'audio') return "bg-green-600/40 border-green-500 text-green-100";
    if (type === 'image') return "bg-purple-600/40 border-purple-500 text-purple-100";
    if (type === 'text') return "bg-yellow-600/40 border-yellow-500 text-yellow-100";
    return "bg-blue-600/40 border-blue-500 text-blue-100";
  }, []);

  // Pistes affichées : text + video + audio en mode 'video', uniquement audio sinon.
  // Toujours dans l'ordre : texte (haut), vidéo, audio (bas).
  const visibleTracks = useMemo(() => {
    const order: Record<string, number> = { text: 0, video: 1, audio: 2 };
    const ordered = [...tracks].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
    if (currentView === 'video') return ordered;
    return ordered.filter(t => t.type === 'audio');
  }, [tracks, currentView]);

  // Quels clips appartiennent à quelle piste — filtre par type-cohérence
  const clipsForTrack = useCallback((track: { id: number; type: string }) => {
    if (track.type === 'text') return clips.filter(c => c.type === 'text');
    return clips.filter(c => c.type !== 'text' && c.track === track.id);
  }, [clips]);

  const rulerMarks = useMemo(() => {
    return Array.from({ length: 200 }).map((_, i) => (
      <div
        key={i}
        className="absolute border-l border-gray-700 h-2 pl-1 text-[10px] text-gray-500"
        style={{ left: i * 100 * zoomLevel }}
      >
        {i * 10}s
      </div>
    ));
  }, [zoomLevel]);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-300 border-t border-gray-700 select-none">
      <TimelineToolbar />
      <div
        ref={timelineRef}
        className={`timeline-container flex-1 overflow-x-auto overflow-y-hidden relative custom-scrollbar ${isScrubbing ? 'cursor-grabbing' : 'cursor-default'}`}
        style={{ touchAction: 'pan-x' }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPointerDown={handleScrubPointerDown}
      >
        {/* RÈGLE */}
        <div className="h-6 bg-gray-950 sticky top-0 border-b border-gray-800 flex items-end z-30 min-w-[10000px]">
          {rulerMarks}
        </div>

        {/* TÊTE DE LECTURE */}
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 w-4 -ml-2 z-50 cursor-ew-resize flex justify-center group"
          style={{
            transform: `translateX(${currentTime * zoomLevel}px)`,
            willChange: 'transform'
          }}
          onPointerDown={(e) => { e.stopPropagation(); handleScrubPointerDown(e); }}
        >
           <div className="w-px h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
           <div className="absolute top-0 w-3 h-3 bg-red-500 rotate-45 -mt-1.5 transform group-hover:scale-125 transition-transform"></div>
        </div>

        {/* PISTES */}
        {visibleTracks.map(track => {
          const isText = track.type === 'text';
          const trackHeight = isText ? 'h-12' : 'h-24';
          const labelBg = isText
            ? 'bg-yellow-900/30 text-yellow-400'
            : track.type === 'video'
              ? 'bg-blue-900/30 text-blue-400'
              : 'bg-green-900/30 text-green-400';
          return (
            <div key={track.id} className={`${trackHeight} bg-gray-900/50 border-b border-gray-800 relative my-1 min-w-[10000px]`}>
              <div className={`absolute top-0 bottom-0 left-0 w-20 border-r border-gray-700 z-40 sticky left-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-tighter ${labelBg}`}>
                {track.name}
              </div>
              {clipsForTrack(track).map(clip => (
                <div
                  key={clip.id}
                  className={`absolute top-1 bottom-1 rounded border overflow-hidden flex items-center px-2 text-xs group transition-all duration-150
                    ${getClipStyle(clip.type)}
                    ${activeTool === 'cut' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}
                    ${selectedClipId === clip.id ? 'ring-2 ring-white border-white z-20 shadow-[0_0_15px_rgba(255,255,255,0.3)]' : 'hover:shadow-lg hover:shadow-white/5'}
                    ${draggingClipId === clip.id ? 'opacity-80 z-30' : ''}
                  `}
                  style={{
                    left: `${clip.start * zoomLevel}px`,
                    width: `${clip.width * zoomLevel}px`,
                    touchAction: 'none', // permet au pointermove tactile sans interférence du scroll
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (activeTool === 'select') {
                      handleClipPointerDown(e, clip);
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeTool === 'select') setSelectedClipId(clip.id);
                    handleClipClick(e, clip);
                  }}
                >
                  {activeTool === 'select' && (
                    <>
                      {/* Trim handles : zone tactile de 14px (≈ pouce iPad) */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-3.5 cursor-ew-resize hover:bg-white/30 z-10 touch-none"
                        style={{ touchAction: 'none' }}
                        onPointerDown={(e) => handleTrim(e, clip, 'start')}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-3.5 cursor-ew-resize hover:bg-white/30 z-10 touch-none"
                        style={{ touchAction: 'none' }}
                        onPointerDown={(e) => handleTrim(e, clip, 'end')}
                      />
                    </>
                  )}
                  {clip.type === 'audio' && clip.src && (
                    <AudioWaveform
                      src={clip.src}
                      durationSeconds={clip.width / PX_PER_SEC_BASE}
                    />
                  )}
                  <div className="relative z-[1] flex items-center min-w-0 w-full">
                    {clip.type === 'audio' && <Music size={12} className="mr-2 shrink-0 opacity-70" />}
                    {clip.type === 'text' && <Type size={12} className="mr-2 shrink-0 opacity-50" />}
                    <span className="truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">{clip.name}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {/* Boutons d'ajout de pistes */}
        <div className="flex items-center gap-2 p-2 min-w-[10000px]">
          <button
            onClick={() => addTrack('video')}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded border border-blue-600/30 transition-all"
            title="Ajouter une piste vidéo"
          >
            <Plus size={14} />
            <Video size={14} />
            <span>Piste Vidéo</span>
          </button>
          <button
            onClick={() => addTrack('audio')}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded border border-green-600/30 transition-all"
            title="Ajouter une piste audio"
          >
            <Plus size={14} />
            <AudioLines size={14} />
            <span>Piste Audio</span>
          </button>
        </div>
      </div>
    </div>
  );
}
