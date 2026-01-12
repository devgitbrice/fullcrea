"use client";

import { useProject } from '@/components/ProjectContext';
import { Settings, Monitor } from 'lucide-react';

export default function ProjectHeader() {
  const { projectSettings } = useProject();

  return (
    <div className="h-14 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-6 select-none">
      
      {/* Partie Gauche (Titre ou Breadcrumb) */}
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <Monitor size={16} />
        <span className="font-medium text-gray-200">Mon Film 01</span>
        <span className="text-gray-600">/</span>
        <span>Édition</span>
      </div>

      {/* Partie Droite : INFOS PROJET DEMANDÉES */}
      <div className="flex items-center gap-4 bg-gray-900 px-3 py-1.5 rounded-md border border-gray-800">
        
        <div className="flex flex-col items-end leading-none">
          <span className="text-xs font-bold text-blue-400">
            {projectSettings.width} x {projectSettings.height}
          </span>
          <span className="text-[10px] text-gray-500">RES</span>
        </div>

        <div className="w-px h-6 bg-gray-800"></div>

        <div className="flex flex-col items-end leading-none">
          <span className="text-xs font-bold text-green-400">
            {projectSettings.fps} FPS
          </span>
          <span className="text-[10px] text-gray-500">RATE</span>
        </div>

        <button className="ml-2 p-1.5 hover:bg-gray-800 rounded-full text-gray-500 transition">
          <Settings size={14} />
        </button>

      </div>
    </div>
  );
}