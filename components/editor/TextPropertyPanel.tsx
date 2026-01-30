"use client";

import { useProject } from '@/components/ProjectContext';
import { Type, Palette, RotateCcw } from 'lucide-react';

const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'Impact',
  'Comic Sans MS',
];

const FONT_SIZES = [12, 16, 20, 24, 32, 48, 64, 72, 96, 128];

export default function TextPropertyPanel() {
  const { clips, setClips, selectedClipId } = useProject();

  const selectedClip = clips.find(c => c.id === selectedClipId);
  const isTextSelected = selectedClip && selectedClip.type === 'text';

  if (!isTextSelected) {
    return null;
  }

  const updateTextProperty = (key: 'text' | 'fontSize' | 'fontFamily' | 'textColor', value: string | number) => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      return { ...c, [key]: value };
    }));
  };

  const resetText = () => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      return {
        ...c,
        text: 'Votre texte ici',
        fontSize: 48,
        fontFamily: 'Arial',
        textColor: '#ffffff'
      };
    }));
  };

  return (
    <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Proprietes Texte</h3>
          <button
            onClick={resetText}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition"
            title="Reinitialiser"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1 truncate">{selectedClip.name}</p>
      </div>

      {/* Controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Contenu texte */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-yellow-400">
            <Type size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Contenu</span>
          </div>
          <textarea
            value={selectedClip.text || ''}
            onChange={(e) => updateTextProperty('text', e.target.value)}
            className="w-full h-24 bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white resize-none focus:outline-none focus:border-yellow-500"
            placeholder="Entrez votre texte..."
          />
        </div>

        {/* Police */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-yellow-400">
            <Type size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Police</span>
          </div>
          <select
            value={selectedClip.fontFamily || 'Arial'}
            onChange={(e) => updateTextProperty('fontFamily', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none focus:border-yellow-500"
          >
            {FONT_FAMILIES.map(font => (
              <option key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </option>
            ))}
          </select>
        </div>

        {/* Taille */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-yellow-400">Taille</span>
            <span className="text-xs font-mono text-yellow-400">{selectedClip.fontSize || 48}px</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {FONT_SIZES.map(size => (
              <button
                key={size}
                onClick={() => updateTextProperty('fontSize', size)}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  (selectedClip.fontSize || 48) === size
                    ? 'bg-yellow-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={8}
            max={200}
            step={1}
            value={selectedClip.fontSize || 48}
            onChange={(e) => updateTextProperty('fontSize', parseInt(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
          />
        </div>

        {/* Couleur */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-yellow-400">
            <Palette size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Couleur</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={selectedClip.textColor || '#ffffff'}
              onChange={(e) => updateTextProperty('textColor', e.target.value)}
              className="w-10 h-10 rounded border border-gray-700 cursor-pointer bg-transparent"
            />
            <input
              type="text"
              value={selectedClip.textColor || '#ffffff'}
              onChange={(e) => updateTextProperty('textColor', e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white font-mono focus:outline-none focus:border-yellow-500"
              placeholder="#ffffff"
            />
          </div>
          {/* Couleurs predefinies */}
          <div className="flex flex-wrap gap-1">
            {['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff6600', '#9900ff'].map(color => (
              <button
                key={color}
                onClick={() => updateTextProperty('textColor', color)}
                className={`w-6 h-6 rounded border-2 transition-all ${
                  (selectedClip.textColor || '#ffffff') === color
                    ? 'border-white scale-110'
                    : 'border-gray-600 hover:border-gray-400'
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Preview Info */}
      <div className="p-4 border-t border-gray-800 bg-gray-950">
        <p className="text-[10px] text-gray-500 text-center">
          Les changements sont appliques en temps reel
        </p>
      </div>
    </div>
  );
}
