"use client";

import { useState } from 'react';
import { useProject, ImageTransform, defaultImageTransform } from '@/components/ProjectContext';
import { RotateCcw, SlidersHorizontal, Sparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import TransformEditor, { PURPLE, SliderControl } from './TransformControls';
import {
  DEFAULT_ZOOM_FX, PX_PER_SEC_BASE, transitionLabel,
  type Clip, type ZoomFx,
} from '@/lib/timeline/types';

type Tab = 'properties' | 'fx';

export default function ImagePropertyPanel() {
  const { clips, setClips, selectedClipId } = useProject();
  // Onglet conservé d'un clip à l'autre (le composant reste monté)
  const [tab, setTab] = useState<Tab>('properties');

  const selectedClip = clips.find(c => c.id === selectedClipId);
  // Images et vidéos partagent la même transformation (position, échelle, rotation)
  const isVisualSelected = selectedClip && (selectedClip.type === 'image' || selectedClip.type === 'video');

  if (!isVisualSelected) {
    return null;
  }

  const transform = selectedClip.transform || defaultImageTransform;

  const updateClip = (update: (c: Clip) => Clip) => {
    setClips(prev => prev.map(c => (c.id === selectedClipId ? update(c) : c)));
  };

  const updateTransform = (key: keyof ImageTransform, value: number) => {
    updateClip(c => ({ ...c, transform: { ...(c.transform || defaultImageTransform), [key]: value } }));
  };

  const resetKeys = (keys: (keyof ImageTransform)[]) => {
    updateClip(c => {
      const next = { ...(c.transform || defaultImageTransform) };
      keys.forEach(key => { next[key] = defaultImageTransform[key]; });
      return { ...c, transform: next };
    });
  };

  const resetTransform = () => {
    updateClip(c => ({ ...c, transform: { ...defaultImageTransform } }));
  };

  const resetFx = () => {
    updateClip(c => ({ ...c, fx: undefined, transition: undefined }));
  };

  const hasFx = !!selectedClip.fx?.zoom?.enabled || !!selectedClip.transition;

  return (
    <div className="w-72 max-w-[40vw] min-w-[220px] bg-gray-900 border-l border-gray-800 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white truncate">
            {selectedClip.type === 'video' ? 'Vidéo' : 'Image'}
          </h3>
          <button
            onClick={tab === 'properties' ? resetTransform : resetFx}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition shrink-0"
            title={tab === 'properties' ? 'Réinitialiser toutes les propriétés' : 'Retirer tous les effets'}
            aria-label={tab === 'properties' ? 'Réinitialiser toutes les propriétés' : 'Retirer tous les effets'}
          >
            <RotateCcw size={12} />
            Réinitialiser
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1 truncate">{selectedClip.name}</p>

        {/* Onglets */}
        <div role="tablist" aria-label="Réglages du clip" className="mt-3 grid grid-cols-2 gap-1 bg-gray-950 p-1 rounded-md border border-gray-800">
          <TabButton active={tab === 'properties'} onClick={() => setTab('properties')} icon={<SlidersHorizontal size={12} />}>
            Propriétés
          </TabButton>
          <TabButton active={tab === 'fx'} onClick={() => setTab('fx')} icon={<Sparkles size={12} />} dot={hasFx}>
            FX
          </TabButton>
        </div>
      </div>

      {/* Controls */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6" role="tabpanel">
        {tab === 'properties' ? (
          <TransformEditor
            transform={transform}
            onChange={updateTransform}
            onReset={resetKeys}
            accent={PURPLE}
            showTilt
          />
        ) : (
          <FxEditor clip={selectedClip} updateClip={updateClip} />
        )}
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

function TabButton({ active, onClick, icon, dot, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; dot?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-semibold transition ${
        active ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-800'
      }`}
    >
      {icon}
      {children}
      {dot && <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-pink-400" aria-label="effets actifs" />}
    </button>
  );
}

/** Choix exclusif sous forme de boutons côte à côte. */
function Segmented<T extends string>({ value, options, onChange, disabled, label }: {
  value: T; options: { id: T; label: string; icon?: React.ReactNode }[];
  onChange: (v: T) => void; disabled?: boolean; label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-400">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid gap-1 bg-gray-950 p-1 rounded-md border border-gray-800" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={`flex items-center justify-center gap-1 py-1 rounded text-xs transition disabled:cursor-not-allowed ${
              value === o.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FxEditor({ clip, updateClip }: { clip: Clip; updateClip: (update: (c: Clip) => Clip) => void }) {
  const zoom: ZoomFx = clip.fx?.zoom ?? { ...DEFAULT_ZOOM_FX, enabled: false };

  const setZoom = (patch: Partial<ZoomFx>) => {
    updateClip(c => {
      const current = c.fx?.zoom ?? { ...DEFAULT_ZOOM_FX, enabled: false };
      return { ...c, fx: { ...c.fx, zoom: { ...current, ...patch } } };
    });
  };

  const transition = clip.transition;
  const maxTransitionSec = Math.max(0.1, Math.round((clip.width / 2 / PX_PER_SEC_BASE) * 10) / 10);

  return (
    <>
      {/* --- ZOOM --- */}
      <section className="space-y-4">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <ZoomIn size={14} className="text-purple-400" />
            Zoom
          </span>
          <input
            type="checkbox"
            checked={zoom.enabled}
            onChange={(e) => setZoom({ enabled: e.target.checked })}
            className="w-4 h-4 accent-purple-500 cursor-pointer"
            aria-label="Activer le zoom"
          />
        </label>

        <div className={`space-y-4 transition ${zoom.enabled ? '' : 'opacity-40 pointer-events-none'}`} aria-disabled={!zoom.enabled}>
          <Segmented
            label="Sens du zoom"
            value={zoom.direction}
            disabled={!zoom.enabled}
            onChange={(direction) => setZoom({ direction })}
            options={[
              { id: 'in', label: 'In', icon: <ZoomIn size={12} /> },
              { id: 'out', label: 'Out', icon: <ZoomOut size={12} /> },
            ]}
          />
          <SliderControl
            label="Profondeur du zoom"
            value={zoom.depth}
            onChange={(depth) => setZoom({ depth })}
            min={0}
            max={100}
            step={1}
            unit="%"
            accent={PURPLE}
          />
          <Segmented
            label="Progression"
            value={zoom.curve}
            disabled={!zoom.enabled}
            onChange={(curve) => setZoom({ curve })}
            options={[
              { id: 'linear', label: 'Linéaire' },
              { id: 'exponential', label: 'Exponentiel' },
            ]}
          />
        </div>
      </section>

      {/* --- TRANSITION D'ENTRÉE --- */}
      <section className="space-y-3 pt-4 border-t border-gray-800">
        <h4 className="text-sm font-semibold text-white">Transition d&apos;entrée</h4>
        {transition ? (
          <>
            <div className="flex items-center justify-between gap-2 rounded-md bg-gray-950 border border-gray-800 px-3 py-2">
              <span className="text-xs text-pink-300 truncate">{transitionLabel(transition.type)}</span>
              <button
                type="button"
                onClick={() => updateClip(c => ({ ...c, transition: undefined }))}
                className="text-gray-500 hover:text-red-400 transition"
                title="Retirer la transition"
                aria-label="Retirer la transition"
              >
                <X size={14} />
              </button>
            </div>
            <SliderControl
              label="Durée"
              value={Math.min(transition.duration / PX_PER_SEC_BASE, maxTransitionSec)}
              onChange={(sec) => updateClip(c => (c.transition ? { ...c, transition: { ...c.transition, duration: sec * PX_PER_SEC_BASE } } : c))}
              min={0.1}
              max={maxTransitionSec}
              step={0.1}
              unit="s"
              accent={PURPLE}
            />
          </>
        ) : (
          <p className="text-xs text-gray-500 leading-relaxed">
            Glissez une transition depuis la bibliothèque (section <span className="text-gray-300">Transitions</span>, sous les fichiers du projet) entre deux images de la timeline.
          </p>
        )}
      </section>
    </>
  );
}
