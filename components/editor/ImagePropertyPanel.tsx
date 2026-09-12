"use client";

import { useProject, ImageTransform, defaultImageTransform } from '@/components/ProjectContext';
import { RotateCcw } from 'lucide-react';
import TransformEditor, { PURPLE } from './TransformControls';

export default function ImagePropertyPanel() {
  const { clips, setClips, selectedClipId } = useProject();

  const selectedClip = clips.find(c => c.id === selectedClipId);
  // Images et vidéos partagent la même transformation (position, échelle, rotation)
  const isVisualSelected = selectedClip && (selectedClip.type === 'image' || selectedClip.type === 'video');

  if (!isVisualSelected) {
    return null;
  }

  const transform = selectedClip.transform || defaultImageTransform;

  const updateTransform = (key: keyof ImageTransform, value: number) => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      return { ...c, transform: { ...(c.transform || defaultImageTransform), [key]: value } };
    }));
  };

  const resetKeys = (keys: (keyof ImageTransform)[]) => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      const next = { ...(c.transform || defaultImageTransform) };
      keys.forEach(key => { next[key] = defaultImageTransform[key]; });
      return { ...c, transform: next };
    }));
  };

  const resetTransform = () => {
    setClips(prev => prev.map(c =>
      c.id === selectedClipId ? { ...c, transform: { ...defaultImageTransform } } : c
    ));
  };

  return (
    <div className="w-72 max-w-[40vw] min-w-[220px] bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white truncate">
            {selectedClip.type === 'video' ? 'Propriétés Vidéo' : 'Propriétés Image'}
          </h3>
          <button
            onClick={resetTransform}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition shrink-0"
            title="Réinitialiser toutes les propriétés"
            aria-label="Réinitialiser toutes les propriétés"
          >
            <RotateCcw size={12} />
            Réinitialiser
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1 truncate">{selectedClip.name}</p>
      </div>

      {/* Controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <TransformEditor
          transform={transform}
          onChange={updateTransform}
          onReset={resetKeys}
          accent={PURPLE}
          showTilt
        />
      </div>

      {/* Preview Info */}
      <div className="p-4 border-t border-gray-800 bg-gray-950">
        <p className="text-[10px] text-gray-500 text-center">
          Les changements sont appliqués en temps réel
        </p>
      </div>
    </div>
  );
}
