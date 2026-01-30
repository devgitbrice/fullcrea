"use client";

import { useState } from 'react';
import { useProject, ImageTransform, defaultImageTransform } from '@/components/ProjectContext';
import { RotateCw, Move, Maximize2, RotateCcw, Lock, Unlock } from 'lucide-react';

interface SliderControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}

function SliderControl({ label, value, onChange, min, max, step = 1, unit = '' }: SliderControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">{label}</span>
        <span className="text-xs font-mono text-purple-400">{value.toFixed(step < 1 ? 2 : 0)}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
      />
    </div>
  );
}

export default function ImagePropertyPanel() {
  const { clips, setClips, selectedClipId } = useProject();
  const [lockRatio, setLockRatio] = useState(true);

  const selectedClip = clips.find(c => c.id === selectedClipId);
  const isImageSelected = selectedClip && selectedClip.type === 'image';

  if (!isImageSelected) {
    return null;
  }

  const transform = selectedClip.transform || defaultImageTransform;

  const updateTransform = (key: keyof ImageTransform, value: number) => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      const currentTransform = c.transform || defaultImageTransform;

      // Si le ratio est verrouillé et qu'on modifie l'échelle
      if (lockRatio && (key === 'scaleX' || key === 'scaleY')) {
        const ratio = currentTransform.scaleX / currentTransform.scaleY;
        if (key === 'scaleX') {
          return {
            ...c,
            transform: {
              ...currentTransform,
              scaleX: value,
              scaleY: value / ratio
            }
          };
        } else {
          return {
            ...c,
            transform: {
              ...currentTransform,
              scaleX: value * ratio,
              scaleY: value
            }
          };
        }
      }

      return {
        ...c,
        transform: {
          ...currentTransform,
          [key]: value
        }
      };
    }));
  };

  const resetTransform = () => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      return {
        ...c,
        transform: { ...defaultImageTransform }
      };
    }));
  };

  return (
    <div className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Propriétés Image</h3>
          <button
            onClick={resetTransform}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition"
            title="Réinitialiser"
          >
            <RotateCcw size={12} />
            Reset
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1 truncate">{selectedClip.name}</p>
      </div>

      {/* Controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Position */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-purple-400">
            <Move size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Position</span>
          </div>
          <div className="space-y-3 pl-1">
            <SliderControl
              label="X"
              value={transform.positionX}
              onChange={(v) => updateTransform('positionX', v)}
              min={-500}
              max={500}
              step={1}
              unit="px"
            />
            <SliderControl
              label="Y"
              value={transform.positionY}
              onChange={(v) => updateTransform('positionY', v)}
              min={-500}
              max={500}
              step={1}
              unit="px"
            />
          </div>
        </div>

        {/* Scale */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-purple-400">
              <Maximize2 size={14} />
              <span className="text-xs font-semibold uppercase tracking-wider">Échelle</span>
            </div>
            <button
              onClick={() => setLockRatio(!lockRatio)}
              className={`p-1 rounded transition-all ${lockRatio ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'}`}
              title={lockRatio ? 'Ratio verrouillé' : 'Ratio libre'}
            >
              {lockRatio ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
          </div>
          <div className="space-y-3 pl-1">
            <SliderControl
              label="X"
              value={transform.scaleX}
              onChange={(v) => updateTransform('scaleX', v)}
              min={0.1}
              max={3}
              step={0.01}
              unit="x"
            />
            <SliderControl
              label="Y"
              value={transform.scaleY}
              onChange={(v) => updateTransform('scaleY', v)}
              min={0.1}
              max={3}
              step={0.01}
              unit="x"
            />
          </div>
          {lockRatio && (
            <p className="text-[10px] text-purple-400/60 pl-1">Ratio hauteur/largeur verrouillé</p>
          )}
        </div>

        {/* Rotation */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-purple-400">
            <RotateCw size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Rotation</span>
          </div>
          <div className="space-y-3 pl-1">
            <SliderControl
              label="Angle (autour du centre)"
              value={transform.rotationZ || 0}
              onChange={(v) => updateTransform('rotationZ', v)}
              min={-180}
              max={180}
              step={1}
              unit="°"
            />
            <div className="border-t border-gray-700 pt-2 mt-2">
              <p className="text-[10px] text-gray-500 mb-2">Rotation 3D</p>
              <SliderControl
                label="Inclinaison X"
                value={transform.rotationX}
                onChange={(v) => updateTransform('rotationX', v)}
                min={-180}
                max={180}
                step={1}
                unit="°"
              />
              <div className="mt-2">
                <SliderControl
                  label="Inclinaison Y"
                  value={transform.rotationY}
                  onChange={(v) => updateTransform('rotationY', v)}
                  min={-180}
                  max={180}
                  step={1}
                  unit="°"
                />
              </div>
            </div>
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
