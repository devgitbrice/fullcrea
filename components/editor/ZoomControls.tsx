"use client";

import { ZoomIn, ZoomOut } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';

export default function ZoomControls() {
  const { zoomLevel, setZoomLevel } = useProject();

  return (
    <div className="flex items-center gap-2 bg-gray-800 px-3 py-1 rounded-md border border-gray-700">
      <ZoomOut size={14} className="text-gray-400" />
      <input 
        type="range" 
        min="0.1" 
        max="5" 
        step="0.1" 
        value={zoomLevel} 
        onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
        className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
      <ZoomIn size={14} className="text-gray-400" />
      <span className="text-[10px] font-mono text-gray-500 w-8">
        {Math.round(zoomLevel * 100)}%
      </span>
    </div>
  );
}