"use client";

import { useEffect } from 'react';
import { MousePointer2, Scissors } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';

export default function TimelineToolbar() {
  const { activeTool, setActiveTool } = useProject();

  // Ajout de raccourcis clavier pour un workflow plus rapide
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // On vérifie que l'utilisateur n'est pas en train d'écrire dans un input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key.toLowerCase() === 'v') setActiveTool('select');
      if (e.key.toLowerCase() === 'c') setActiveTool('cut');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool]);

  return (
    <div className="h-10 flex items-center px-4 gap-2 border-b border-gray-800 bg-gray-950 select-none shrink-0">
      {/* Bouton Sélection */}
      <button 
        onClick={() => setActiveTool('select')}
        className={`p-1.5 rounded transition-all duration-200 ${
          activeTool === 'select' 
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
            : 'hover:bg-gray-800 text-gray-400'
        }`}
        title="Outil Sélection (V)"
      >
        <MousePointer2 size={18} />
      </button>

      {/* Bouton Cutter */}
      <button 
        onClick={() => setActiveTool('cut')}
        className={`p-1.5 rounded transition-all duration-200 ${
          activeTool === 'cut' 
            ? 'bg-red-600 text-white shadow-lg shadow-red-900/20' 
            : 'hover:bg-gray-800 text-gray-400'
        }`}
        title="Outil Cutter (C)"
      >
        <Scissors size={18} />
      </button>

      {/* Séparateur visuel */}
      <div className="w-px h-4 bg-gray-800 mx-2" />

      {/* Label d'état */}
      <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest hidden sm:inline">
        Outil actuel : <span className={activeTool === 'cut' ? 'text-red-500' : 'text-blue-500'}>
          {activeTool === 'select' ? 'Sélection' : 'Cutter'}
        </span>
      </span>
    </div>
  );
}