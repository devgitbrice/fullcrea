"use client";

import { Video, Mic, Music } from 'lucide-react';
import { useProject, ViewMode } from '@/components/ProjectContext';

const VIEWS: { id: ViewMode; label: string; title: string; Icon: typeof Video }[] = [
  { id: 'video',   label: 'Vidéo',   title: 'Mode vidéo — montage avec aperçu',  Icon: Video },
  { id: 'music',   label: 'Musique', title: 'Mode musique — timeline compacte',   Icon: Music },
  { id: 'podcast', label: 'Podcast', title: 'Mode podcast — timeline compacte',   Icon: Mic },
];

export default function ViewSelector() {
  const { currentView, setCurrentView } = useProject();

  return (
    <div
      role="group"
      aria-label="Mode d'édition"
      className="h-10 bg-black border-b border-gray-800 flex items-center justify-center gap-2 shrink-0"
    >
      {VIEWS.map(({ id, label, title, Icon }) => {
        const isActive = currentView === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setCurrentView(id)}
            aria-pressed={isActive}
            title={title}
            className={`flex items-center gap-1.5 px-4 py-1 rounded-full text-sm font-medium transition-all duration-200 ${
              isActive
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            }`}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
