"use client";

import { useEffect, useState } from 'react';
import { Lock, Maximize2, Move, RotateCcw, RotateCw, Unlock } from 'lucide-react';
import type { ImageTransform } from '@/lib/timeline/types';
import { defaultImageTransform } from '@/components/ProjectContext';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Les classes sont écrites en toutes lettres : Tailwind ne génère pas celles
// construites par interpolation.
export interface Accent {
  text: string;
  border: string;
  range: string;
  bg: string;
  soft: string;
}

export const PURPLE: Accent = {
  text: 'text-purple-400',
  border: 'focus:border-purple-500',
  range: 'accent-purple-500',
  bg: 'bg-purple-600',
  soft: 'text-purple-400/60',
};

export const YELLOW: Accent = {
  text: 'text-yellow-400',
  border: 'focus:border-yellow-500',
  range: 'accent-yellow-500',
  bg: 'bg-yellow-600',
  soft: 'text-yellow-400/60',
};

export const POSITION_KEYS: (keyof ImageTransform)[] = ['positionX', 'positionY'];
export const SCALE_KEYS: (keyof ImageTransform)[] = ['scaleX', 'scaleY'];
export const ROTATION_KEYS: (keyof ImageTransform)[] = ['rotationX', 'rotationY', 'rotationZ'];

interface SliderControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  shiftHeld?: boolean;
  accent?: Accent;
}

/** Curseur + saisie exacte, avec pas ×10 quand Maj est enfoncée. */
export function SliderControl({
  label, value, onChange, min, max, step = 1, unit = '', shiftHeld = false, accent = PURPLE,
}: SliderControlProps) {
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
            onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
            aria-label={`${label}${unit ? ` (${unit})` : ''}`}
            title="Saisir une valeur exacte"
            className={`w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-right font-mono ${accent.text} focus:outline-none ${accent.border} transition [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
          />
          {unit && <span className={`text-xs font-mono ${accent.text} w-4`}>{unit}</span>}
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
        className={`w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer ${accent.range}`}
      />
    </div>
  );
}

export function SectionResetButton({ onClick, title }: { onClick: () => void; title: string }) {
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

/** Suit la touche Maj (pas ×10 sur les curseurs). */
export function useShiftHeld(): boolean {
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
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
  return shiftHeld;
}

interface TransformEditorProps {
  transform: ImageTransform;
  onChange: (key: keyof ImageTransform, value: number) => void;
  onReset: (keys: (keyof ImageTransform)[]) => void;
  /** Rotations 3D (inclinaison X/Y) : utiles pour une image, hors sujet pour un texte */
  showTilt?: boolean;
  accent?: Accent;
  /** Amplitude du déplacement, en pixels projet */
  positionRange?: number;
}

/**
 * Réglages communs de placement : position X/Y, échelle X/Y (liées ou non) et
 * rotation. Partagés par les propriétés d'image/vidéo et de texte.
 */
export default function TransformEditor({
  transform, onChange, onReset, showTilt = false, accent = PURPLE, positionRange = 500,
}: TransformEditorProps) {
  const [lockRatio, setLockRatio] = useState(true);
  const shiftHeld = useShiftHeld();

  // Échelle liée : on conserve le rapport X/Y courant
  const changeScale = (key: 'scaleX' | 'scaleY', value: number) => {
    if (!lockRatio) {
      onChange(key, value);
      return;
    }
    const ratio = transform.scaleY !== 0 ? transform.scaleX / transform.scaleY : 1;
    if (key === 'scaleX') {
      onChange('scaleX', value);
      onChange('scaleY', ratio !== 0 ? value / ratio : value);
    } else {
      onChange('scaleY', value);
      onChange('scaleX', value * ratio);
    }
  };

  return (
    <>
      {/* Position */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 ${accent.text}`}>
            <Move size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Position</span>
          </div>
          <SectionResetButton onClick={() => onReset(POSITION_KEYS)} title="Réinitialiser la position" />
        </div>
        <div className="space-y-3 pl-1">
          <SliderControl
            label="X" value={transform.positionX} onChange={(v) => onChange('positionX', v)}
            min={-positionRange} max={positionRange} step={1} unit="px" shiftHeld={shiftHeld} accent={accent}
          />
          <SliderControl
            label="Y" value={transform.positionY} onChange={(v) => onChange('positionY', v)}
            min={-positionRange} max={positionRange} step={1} unit="px" shiftHeld={shiftHeld} accent={accent}
          />
        </div>
        <p className={`text-[10px] pl-1 transition-colors ${shiftHeld ? accent.text : 'text-gray-500'}`}>
          Astuce : maintenez Maj pour des pas de 10
        </p>
      </div>

      {/* Échelle */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 ${accent.text}`}>
            <Maximize2 size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Échelle</span>
          </div>
          <div className="flex items-center gap-2">
            <SectionResetButton onClick={() => onReset(SCALE_KEYS)} title="Réinitialiser l'échelle" />
            <button
              onClick={() => setLockRatio(!lockRatio)}
              className={`p-1 rounded transition-all ${lockRatio ? `${accent.bg} text-white` : 'bg-gray-700 text-gray-400 hover:text-white'}`}
              title={lockRatio ? 'X et Y liés — cliquez pour les régler séparément' : 'X et Y indépendants — cliquez pour les lier'}
              aria-label={lockRatio ? 'Lier X et Y' : 'Régler X et Y séparément'}
              aria-pressed={lockRatio}
            >
              {lockRatio ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
          </div>
        </div>
        <div className="space-y-3 pl-1">
          <SliderControl
            label="X" value={transform.scaleX} onChange={(v) => changeScale('scaleX', v)}
            min={0.1} max={3} step={0.01} unit="x" shiftHeld={shiftHeld} accent={accent}
          />
          <SliderControl
            label="Y" value={transform.scaleY} onChange={(v) => changeScale('scaleY', v)}
            min={0.1} max={3} step={0.01} unit="x" shiftHeld={shiftHeld} accent={accent}
          />
        </div>
        {lockRatio && <p className={`text-[10px] ${accent.soft} pl-1`}>X et Y changent ensemble</p>}
      </div>

      {/* Rotation */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 ${accent.text}`}>
            <RotateCw size={14} />
            <span className="text-xs font-semibold uppercase tracking-wider">Rotation</span>
          </div>
          <SectionResetButton onClick={() => onReset(ROTATION_KEYS)} title="Réinitialiser la rotation" />
        </div>
        <div className="space-y-3 pl-1">
          <SliderControl
            label="Angle (autour du centre)" value={transform.rotationZ || 0}
            onChange={(v) => onChange('rotationZ', v)}
            min={-180} max={180} step={1} unit="°" shiftHeld={shiftHeld} accent={accent}
          />
          {showTilt && (
            <div className="border-t border-gray-700 pt-2 mt-2">
              <p className="text-[10px] text-gray-500 mb-2">Rotation 3D</p>
              <SliderControl
                label="Inclinaison X" value={transform.rotationX} onChange={(v) => onChange('rotationX', v)}
                min={-180} max={180} step={1} unit="°" shiftHeld={shiftHeld} accent={accent}
              />
              <div className="mt-2">
                <SliderControl
                  label="Inclinaison Y" value={transform.rotationY} onChange={(v) => onChange('rotationY', v)}
                  min={-180} max={180} step={1} unit="°" shiftHeld={shiftHeld} accent={accent}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export { defaultImageTransform };
