"use client";

import { useState } from 'react';
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
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 200;
const DEFAULT_FONT_SIZE = 48;

const PRESET_COLORS = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff6600', '#9900ff'];

const HEADER_TEXT_MAX = 40;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function TextPropertyPanel() {
  const { clips, setClips, selectedClipId } = useProject();
  // Brouillon local pour laisser l'utilisateur vider le champ ou taper une valeur hors bornes avant validation
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);

  const selectedClip = clips.find(c => c.id === selectedClipId);
  const isTextSelected = selectedClip && selectedClip.type === 'text';

  if (!isTextSelected) {
    return null;
  }

  const fontSize = selectedClip.fontSize || DEFAULT_FONT_SIZE;
  const textColor = selectedClip.textColor || '#ffffff';
  const trimmedText = (selectedClip.text || '').trim();
  const headerLabel = trimmedText
    ? trimmedText.length > HEADER_TEXT_MAX
      ? `${trimmedText.slice(0, HEADER_TEXT_MAX)}…`
      : trimmedText
    : selectedClip.name;

  const updateTextProperty = (key: 'text' | 'fontSize' | 'fontFamily' | 'textColor', value: string | number) => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      return { ...c, [key]: value };
    }));
  };

  const commitFontSize = (raw: string) => {
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    const clamped = clamp(parsed, MIN_FONT_SIZE, MAX_FONT_SIZE);
    if (clamped !== fontSize) updateTextProperty('fontSize', clamped);
  };

  const resetText = () => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      return {
        ...c,
        text: 'Votre texte ici',
        fontSize: DEFAULT_FONT_SIZE,
        fontFamily: 'Arial',
        textColor: '#ffffff'
      };
    }));
  };

  return (
    <div className="w-72 max-w-[40vw] min-w-[220px] bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white truncate">Propriétés Texte</h3>
          <button
            onClick={resetText}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition shrink-0"
            title="Réinitialiser"
            aria-label="Réinitialiser les propriétés du texte"
          >
            <RotateCcw size={12} />
            Réinitialiser
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1 truncate" title={trimmedText || selectedClip.name}>{headerLabel}</p>
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
            aria-label="Contenu du texte"
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
            aria-label="Police de caractères"
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
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-yellow-400">Taille</span>
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                min={MIN_FONT_SIZE}
                max={MAX_FONT_SIZE}
                step={1}
                value={sizeDraft ?? fontSize}
                onChange={(e) => {
                  setSizeDraft(e.target.value);
                  commitFontSize(e.target.value);
                }}
                onBlur={() => setSizeDraft(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                }}
                aria-label="Taille du texte (px)"
                title={`Taille exacte (${MIN_FONT_SIZE}–${MAX_FONT_SIZE} px)`}
                className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-right font-mono text-yellow-400 focus:outline-none focus:border-yellow-500 transition [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="text-xs font-mono text-yellow-400">px</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {FONT_SIZES.map(size => (
              <button
                key={size}
                onClick={() => updateTextProperty('fontSize', size)}
                title={`Taille ${size} px`}
                aria-label={`Taille ${size} px`}
                aria-pressed={fontSize === size}
                className={`px-2 py-1 text-xs rounded transition-all ${
                  fontSize === size
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
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={fontSize}
            onChange={(e) => updateTextProperty('fontSize', parseInt(e.target.value, 10))}
            aria-label="Taille du texte"
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
              value={textColor}
              onChange={(e) => updateTextProperty('textColor', e.target.value)}
              aria-label="Sélecteur de couleur"
              title="Sélecteur de couleur"
              className="w-10 h-10 rounded border border-gray-700 cursor-pointer bg-transparent"
            />
            <input
              type="text"
              value={textColor}
              onChange={(e) => updateTextProperty('textColor', e.target.value)}
              aria-label="Code couleur hexadécimal"
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white font-mono focus:outline-none focus:border-yellow-500"
              placeholder="#ffffff"
            />
          </div>
          {/* Couleurs prédéfinies */}
          <div className="flex flex-wrap gap-1">
            {PRESET_COLORS.map(color => (
              <button
                key={color}
                onClick={() => updateTextProperty('textColor', color)}
                className={`w-6 h-6 rounded border-2 transition-all ${
                  textColor === color
                    ? 'border-white scale-110'
                    : 'border-gray-600 hover:border-gray-400'
                }`}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`Couleur ${color}`}
                aria-pressed={textColor === color}
              />
            ))}
          </div>
        </div>
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
