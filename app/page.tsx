"use client";

import { useEffect } from 'react';
import Sidebar from '@/components/editor/Sidebar';
import Player from '@/components/editor/Player';
import Timeline from '@/components/editor/Timeline';
import PreviewModal from '@/components/PreviewModal'; 
import ProjectHeader from '@/components/editor/ProjectHeader'; 
import ViewSelector from '@/components/editor/ViewSelector'; 
import { ProjectProvider, useProject } from '@/components/ProjectContext';

function EditorLayout() {
  const { currentView } = useProject();

  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const target = e.target as HTMLElement;
        // On vérifie si l'utilisateur survole la Timeline
        const isTimelineZone = target.closest('.timeline-container');

        if (!isTimelineZone) {
          // Cas 1 : On est sur la Sidebar/Player -> On bloque le zoom Chrome
          if (e.cancelable) e.preventDefault();
        } 
        // Cas 2 : On est sur la Timeline -> On ne fait rien, 
        // on laisse l'événement arriver à Timeline.tsx
      }
    };

    // TRÈS IMPORTANT : capture: true pour intercepter AVANT le bubbling
    window.addEventListener('wheel', handleGlobalWheel, { passive: false, capture: true });
    
    return () => {
      window.removeEventListener('wheel', handleGlobalWheel, { capture: true });
    };
  }, []);

  return (
    <div className="flex h-screen bg-black text-white overflow-hidden relative font-sans flex-col">
        <ViewSelector />
        <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <ProjectHeader />
              <div className={`
                 relative z-0 bg-gray-900 border-b border-gray-800 transition-all duration-300 ease-in-out
                 ${currentView === 'video' ? 'h-[60%]' : 'h-16 shrink-0'} 
              `}>
                <Player />
              </div>
              <div className="flex-1 bg-gray-950 z-0 min-h-0">
                <Timeline />
              </div>
            </div>
        </div>
        <PreviewModal />
    </div>
  );
}

export default function EditorPage() {
  return (
    <ProjectProvider>
       <EditorLayout />
    </ProjectProvider>
  );
}