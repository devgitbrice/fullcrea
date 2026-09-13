"use client";

import { useEffect } from 'react';
import Sidebar from '@/components/editor/Sidebar';
import Player from '@/components/editor/Player';
import Timeline from '@/components/editor/Timeline';
import PreviewModal from '@/components/PreviewModal';
import ProjectHeader from '@/components/editor/ProjectHeader';
import ViewSelector from '@/components/editor/ViewSelector';
import ImagePropertyPanel from '@/components/editor/ImagePropertyPanel';
import TextPropertyPanel from '@/components/editor/TextPropertyPanel';
import QuickLinks from '@/components/QuickLinks';
import { useProject } from '@/components/ProjectContext';

export default function EditorLayout() {
  const { currentView } = useProject();

  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const target = e.target as HTMLElement;
        // Sur la Timeline, l'événement doit arriver à Timeline.tsx (zoom) ;
        // ailleurs on bloque le zoom du navigateur.
        const isTimelineZone = target.closest('.timeline-container');
        if (!isTimelineZone && e.cancelable) e.preventDefault();
      }
    };

    // capture: true pour intercepter AVANT le bubbling
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
                <div className="flex h-full">
                  <div className="flex-1">
                    <Player />
                  </div>
                  <ImagePropertyPanel />
                  <TextPropertyPanel />
                </div>
              </div>
              <div className="flex-1 bg-gray-950 z-0 min-h-0">
                <Timeline />
              </div>
            </div>
        </div>
        <PreviewModal />
        <QuickLinks />
    </div>
  );
}
