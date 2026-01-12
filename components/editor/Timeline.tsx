"use client";

import { useRef, DragEvent, useState, useEffect, MouseEvent as ReactMouseEvent } from 'react';
import { Music } from 'lucide-react';
import { useProject, Clip } from '@/components/ProjectContext'; 
import TimelineToolbar from './TimelineToolbar';

export default function Timeline() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const { 
    clips, 
    setClips, 
    currentTime, 
    setCurrentTime, 
    currentView, 
    activeTool, 
    zoomLevel, 
    setZoomLevel,
    selectedClipId,
    setSelectedClipId 
  } = useProject();
  
  const [isScrubbing, setIsScrubbing] = useState(false);

  // --- GESTION DE LA SUPPRESSION (CLAVIER) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // On vérifie qu'on n'est pas dans un champ de texte
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        setClips(prev => prev.filter(c => c.id !== selectedClipId));
        setSelectedClipId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, setClips, setSelectedClipId]);

  // --- FORCE LE BLOCAGE DU ZOOM CHROME ---
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;

    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        const zoomSpeed = 0.001;
        const delta = -e.deltaY * zoomSpeed;

        setZoomLevel(prev => {
          const nextZoom = prev + delta;
          return Math.min(Math.max(0.1, nextZoom), 10);
        });
      }
    };

    el.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', handleWheelNative);
  }, [setZoomLevel]);

  // --- LOGIQUE DE COUPE (CUTTER) ---
  const handleClipClick = (e: ReactMouseEvent, clip: Clip) => {
    if (activeTool !== 'cut') return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cutPointX = (e.clientX - rect.left) / zoomLevel; 

    const clipA: Clip = { ...clip, width: cutPointX, id: `${clip.id}_p1_${Date.now()}` };
    const clipB: Clip = { 
      ...clip, 
      id: `${clip.id}_p2_${Date.now()}`, 
      start: clip.start + cutPointX, 
      width: clip.width - cutPointX 
    };

    setClips(prev => [...prev.filter(c => c.id !== clip.id), clipA, clipB]);
    setSelectedClipId(null); // On désélectionne après une coupe
  };

  // --- LOGIQUE DE TRIMMING ---
  const handleTrim = (e: ReactMouseEvent, clip: Clip, edge: 'start' | 'end') => {
    if (activeTool !== 'select') return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const initialWidth = clip.width;
    const initialStart = clip.start;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = (moveEvent.clientX - startX) / zoomLevel;
      setClips(prev => prev.map(c => {
        if (c.id !== clip.id) return c;
        if (edge === 'end') {
          return { ...c, width: Math.max(5, initialWidth + deltaX) };
        } else {
          const newStart = initialStart + deltaX;
          const newWidth = initialWidth - deltaX;
          return newWidth > 5 ? { ...c, start: newStart, width: newWidth } : c;
        }
      }));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  // --- LOGIQUE DE SCRUBBING ---
  const handleMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    
    // Si on clique sur le fond (pas un clip), on désélectionne
    if (e.target === e.currentTarget) {
        setSelectedClipId(null);
    }

    setIsScrubbing(true);
    updateTimeFromMouse(e.clientX);
    document.addEventListener('mousemove', handleMouseMoveGlobal);
    document.addEventListener('mouseup', handleMouseUpGlobal);
  };

  const handleMouseMoveGlobal = (e: MouseEvent) => updateTimeFromMouse(e.clientX);
  const handleMouseUpGlobal = () => {
    setIsScrubbing(false);
    document.removeEventListener('mousemove', handleMouseMoveGlobal);
    document.removeEventListener('mouseup', handleMouseUpGlobal);
  };

  const updateTimeFromMouse = (clientX: number) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) + timelineRef.current.scrollLeft) / zoomLevel;
    setCurrentTime(Math.max(0, x));
  };

  // --- DRAG & DROP ---
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const dropX = ((e.clientX - rect.left) + timelineRef.current.scrollLeft) / zoomLevel;
    const dataString = e.dataTransfer.getData("application/react-dnd");
    if (!dataString) return;
    const data = JSON.parse(dataString);

    if (data.isNew) {
      const newClip: Clip = {
        id: `clip_${Date.now()}`,
        name: data.name,
        type: data.type.startsWith('video') ? 'video' : data.type.startsWith('audio') ? 'audio' : 'image',
        track: data.type.startsWith('audio') ? 2 : 1, 
        start: Math.max(0, dropX),
        width: 150,
        src: data.src
      };
      setClips(prev => [...prev, newClip]);
    } else {
      setClips(prev => prev.map(c => c.id === data.id ? { ...c, start: Math.max(0, dropX) } : c));
    }
  };

  const getClipStyle = (type: string) => {
    if (type === 'audio') return "bg-green-600/40 border-green-500 text-green-100";
    if (type === 'image') return "bg-purple-600/40 border-purple-500 text-purple-100";
    return "bg-blue-600/40 border-blue-500 text-blue-100";
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-300 border-t border-gray-700 select-none">
      <TimelineToolbar />
      <div 
        ref={timelineRef} 
        className={`timeline-container flex-1 overflow-x-auto overflow-y-hidden relative custom-scrollbar ${isScrubbing ? 'cursor-grabbing' : 'cursor-default'}`}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onMouseDown={handleMouseDown}
      >
        {/* RÈGLE */}
        <div className="h-6 bg-gray-950 sticky top-0 border-b border-gray-800 flex items-end z-30 min-w-[10000px]">
          {Array.from({ length: 200 }).map((_, i) => (
             <div key={i} className="absolute border-l border-gray-700 h-2 pl-1 text-[10px] text-gray-500" style={{ left: i * 100 * zoomLevel }}>
               {i * 10}s
             </div>
          ))}
        </div>

        {/* TÊTE DE LECTURE */}
        <div 
          className="absolute top-0 bottom-0 w-4 -ml-2 z-50 cursor-ew-resize flex justify-center group"
          style={{ left: `${currentTime * zoomLevel}px` }}
          onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e); }}
        >
           <div className="w-px h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
           <div className="absolute top-0 w-3 h-3 bg-red-500 rotate-45 -mt-1.5 transform group-hover:scale-125 transition-transform"></div>
        </div>

        {/* PISTES */}
        {[1, 2].map(trackIndex => (
          (trackIndex === 1 && currentView !== 'video') ? null : (
            <div key={trackIndex} className="h-24 bg-gray-900/50 border-b border-gray-800 relative my-1 min-w-[10000px]">
              <div className="absolute top-0 bottom-0 left-0 w-20 bg-gray-800 border-r border-gray-700 z-40 sticky left-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-tighter text-gray-500">
                {trackIndex === 1 ? 'Video' : 'Audio'}
              </div>
              {clips.filter(c => c.track === trackIndex).map(clip => (
                <div 
                  key={clip.id} 
                  className={`absolute top-2 bottom-2 rounded border overflow-hidden flex items-center px-2 text-xs group transition-all duration-150 
                    ${getClipStyle(clip.type)} 
                    ${activeTool === 'cut' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}
                    ${selectedClipId === clip.id ? 'ring-2 ring-white border-white z-20 shadow-[0_0_15px_rgba(255,255,255,0.3)]' : 'hover:shadow-lg hover:shadow-white/5'}
                  `}
                  style={{ left: `${clip.start * zoomLevel}px`, width: `${clip.width * zoomLevel}px` }}
                  draggable={activeTool === 'select'}
                  onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData("application/react-dnd", JSON.stringify(clip)); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (activeTool === 'select') {
                        setSelectedClipId(clip.id);
                    }
                    handleClipClick(e, clip);
                  }}
                >
                  {activeTool === 'select' && (
                    <>
                      <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 z-10" onMouseDown={(e) => handleTrim(e, clip, 'start')} />
                      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/30 z-10" onMouseDown={(e) => handleTrim(e, clip, 'end')} />
                    </>
                  )}
                  {clip.type === 'audio' && <Music size={12} className="mr-2 shrink-0 opacity-50" />}
                  <span className="truncate">{clip.name}</span>
                </div>
              ))}
            </div>
          )
        ))}
      </div>
    </div>
  );
}