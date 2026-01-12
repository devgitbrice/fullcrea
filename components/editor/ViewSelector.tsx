"use client";

import { Video, Mic, Music } from 'lucide-react';
import { useProject, ViewMode } from '@/components/ProjectContext';

export default function ViewSelector() {
  const { currentView, setCurrentView } = useProject();

  const getButtonStyle = (view: ViewMode) => {
    const isActive = currentView === view;
    return `flex items-center gap-2 px-6 py-2 rounded-full font-medium transition-all duration-200 ${
      isActive 
        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' 
        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
    }`;
  };

  return (
    <div className="h-16 bg-black border-b border-gray-800 flex items-center justify-center gap-4 shrink-0">
      <button 
        onClick={() => setCurrentView('video')} 
        className={getButtonStyle('video')}
      >
        <Video size={18} />
        <span>Vidéo</span>
      </button>

      <button 
        onClick={() => setCurrentView('music')} 
        className={getButtonStyle('music')}
      >
        <Music size={18} />
        <span>Musique</span>
      </button>

      <button 
        onClick={() => setCurrentView('podcast')} 
        className={getButtonStyle('podcast')}
      >
        <Mic size={18} />
        <span>Podcast</span>
      </button>
    </div>
  );
}