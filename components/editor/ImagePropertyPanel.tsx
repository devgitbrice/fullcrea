"use client";

import { useEffect, useState } from 'react';
import { useProject, ImageTransform, defaultImageTransform } from '@/components/ProjectContext';
import { RotateCw, Move, Maximize2, RotateCcw, Lock, Unlock } from 'lucide-react';

const POSITION_KEYS: (keyof ImageTransform)[] = ['positionX', 'positionY'];
const SCALE_KEYS: (keyof ImageTransform)[] = ['scaleX', 'scaleY'];
const ROTATION_KEYS: (keyof ImageTransform)[] = ['rotationX', 'rotationY', 'rotationZ'];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface SliderControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  shiftHeld?: boolean;
}

function SliderControl({ label, value, onChange, min, max, step = 1, unit = '', shiftHeld = false }: SliderControlProps) {
  // Brouillon local pour laisser l'utilisateur taper "-" ou "1." sans être écrasé
  const [draft, setDraft] = useState<string | null>(null);
  const decimals = step < 1 ? 2 : 0;
  const effectiveStep = shiftHeld ? step * 10 : step;
  const displayValue = draft ?? value.toFixed(decimals);

  const commit = (raw: string) => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = clamp(parsed, min, max);
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center gap-2">
        <span className="text-xs text-gray-400 truncate">{label}</span>
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="number"
            min={min}
            max={max}
            step={effectiveStep}
            value={displayValue}
            onChange={(e) => {
              setDraft(e.target.value);
              commit(e.target.value);
            }}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
            aria-label={`${label}${unit ? ` (${unit})` : ''}`}
            title="Saisir une valeur exacte"
            className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-right font-mono text-purple-400 focus:outline-none focus:border-purple-500 transition [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {unit && <span className="text-xs font-mono text-purple-400 w-4">{unit}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={effectiveStep}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
      />
    </div>
  );
}

interface SectionResetButtonProps {
  onClick: () => void;
  title: string;
}

function SectionResetButton({ onClick, title }: SectionResetButtonProps) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1 transition"
      title={title}
      aria-label={title}
    >
      <RotateCcw size={10} />
      Réinitialiser
    </button>
  );
}

export default function ImagePropertyPanel() {
  const { clips, setClips, selectedClipId } = useProject();
  const [lockRatio, setLockRatio] = useState(true);
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
    };
    // Si la fenêtre perd le focus pendant que Maj est enfoncée, on ne reçoit jamais le keyup
    const onBlur = () => setShiftHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

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

  const resetKeys = (keys: (keyof ImageTransform)[]) => {
    setClips(prev => prev.map(c => {
      if (c.id !== selectedClipId) return c;
      const currentTransform = c.transform || defaultImageTransform;
      const next = { ...currentTransform };
      keys.forEach(key => {
        next[key] = defaultImageTransform[key];
      });
      return { ...c, transform: next };
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
    <div className="w-72 max-w-[40vw] min-w-[220px] bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white truncate">Propriétés Image</h3>
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
        {/* Position */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-purple-400">
              <Move size={14} />
              <span className="text-xs font-semibold uppercase tracking-wider">Position</span>
            </div>
            <SectionResetButton
              onClick={() => resetKeys(POSITION_KEYS)}
              title="Réinitialiser la position"
            />
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
              shiftHeld={shiftHeld}
            />
            <SliderControl
              label="Y"
              value={transform.positionY}
              onChange={(v) => updateTransform('positionY', v)}
              min={-500}
              max={500}
              step={1}
              unit="px"
              shiftHeld={shiftHeld}
            />
          </div>
          <p className={`text-[10px] pl-1 transition-colors ${shiftHeld ? 'text-purple-400' : 'text-gray-500'}`}>
            Astuce : maintenez Maj pour des pas de 10
          </p>
        </div>

        {/* Scale */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-purple-400">
              <Maximize2 size={14} />
              <span className="text-xs font-semibold uppercase tracking-wider">Échelle</span>
            </div>
            <div className="flex items-center gap-2">
              <SectionResetButton
                onClick={() => resetKeys(SCALE_KEYS)}
                title="Réinitialiser l'échelle"
              />
              <button
                onClick={() => setLockRatio(!lockRatio)}
                className={`p-1 rounded transition-all ${lockRatio ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'}`}
                title={lockRatio ? 'Ratio verrouillé' : 'Ratio libre'}
                aria-label={lockRatio ? 'Ratio verrouillé' : 'Ratio libre'}
                aria-pressed={lockRatio}
              >
                {lockRatio ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
            </div>
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
              shiftHeld={shiftHeld}
            />
            <SliderControl
              label="Y"
              value={transform.scaleY}
              onChange={(v) => updateTransform('scaleY', v)}
              min={0.1}
              max={3}
              step={0.01}
              unit="x"
              shiftHeld={shiftHeld}
            />
          </div>
          {lockRatio && (
            <p className="text-[10px] text-purple-400/60 pl-1">Ratio hauteur/largeur verrouillé</p>
          )}
        </div>

        {/* Rotation */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-purple-400">
              <RotateCw size={14} />
              <span className="text-xs font-semibold uppercase tracking-wider">Rotation</span>
            </div>
            <SectionResetButton
              onClick={() => resetKeys(ROTATION_KEYS)}
              title="Réinitialiser la rotation"
            />
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
              shiftHeld={shiftHeld}
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
                shiftHeld={shiftHeld}
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
                  shiftHeld={shiftHeld}
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
