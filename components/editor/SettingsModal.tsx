"use client";

import { useState, useId, useRef, FormEvent } from 'react';
import { useProject } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { X, Settings, Trash2, Save, RectangleHorizontal, RectangleVertical, Square } from 'lucide-react';

export interface FormatPreset {
  label: string;
  ratio: string;
  width: number;
  height: number;
  Icon: typeof RectangleHorizontal;
}

export const FORMAT_PRESETS: FormatPreset[] = [
  { label: 'Paysage', ratio: '16:9',  width: 1920, height: 1080, Icon: RectangleHorizontal },
  { label: 'Portrait', ratio: '9:16', width: 1080, height: 1920, Icon: RectangleVertical },
  { label: 'Carré',   ratio: '1:1',   width: 1080, height: 1080, Icon: Square },
  { label: 'Vertical', ratio: '3:4',  width: 1080, height: 1440, Icon: RectangleVertical },
];

export function isSamePreset(a: { width: number; height: number }, p: FormatPreset) {
  return a.width === p.width && a.height === p.height;
}

const FPS_OPTIONS = [24, 25, 30, 50, 60];
const MIN_DIMENSION = 16;
const MAX_DIMENSION = 8192;

// Les dimensions vidéo doivent être paires pour l'encodage (yuv420p)
function clampDimension(value: number) {
  if (!Number.isFinite(value)) return MIN_DIMENSION;
  const clamped = Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value)));
  return clamped - (clamped % 2);
}

const inputClass = 'w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-600';
const labelClass = 'block text-xs text-gray-400 mb-1';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const { currentProject, projectSettings, setProjectSettings, renameProject, deleteProject, accessRole } = useProject();
  const { toast } = useToast();
  const titleId = useId();
  const nameId = useId();
  const fpsId = useId();
  const widthId = useId();
  const heightId = useId();

  const [name, setName] = useState(currentProject.name);
  const [fps, setFps] = useState(projectSettings.fps);
  // Chaînes pour laisser l'utilisateur vider le champ sans produire un NaN contrôlé
  const [width, setWidth] = useState(String(projectSettings.width));
  const [height, setHeight] = useState(String(projectSettings.height));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const draftSize = { width: Number(width), height: Number(height) };

  // Évite de fermer la modale quand une sélection de texte démarrée dans le
  // formulaire se termine sur le fond sombre (le click remonte au backdrop).
  const backdropMouseDown = useRef(false);

  useEscapeKey(onClose);

  const canSave = name.trim().length > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    const trimmed = name.trim();
    if (trimmed !== currentProject.name) {
      renameProject(currentProject.id, trimmed);
    }
    setProjectSettings({
      width: clampDimension(draftSize.width),
      height: clampDimension(draftSize.height),
      fps,
    });
    toast({ message: 'Paramètres enregistrés', type: 'success' });
    onClose();
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const deletedName = currentProject.name;
    deleteProject(currentProject.id);
    toast({ message: `Projet « ${deletedName} » supprimé`, type: 'success' });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        const onBackdrop = backdropMouseDown.current && e.target === e.currentTarget;
        backdropMouseDown.current = false;
        if (onBackdrop) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md bg-gray-950 border border-gray-800 rounded-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Settings size={14} className="text-blue-400" />
            <h2 id={titleId}>Paramètres du projet</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer"
            className="text-gray-500 hover:text-white transition"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label htmlFor={nameId} className={labelClass}>Nom du projet</label>
            <input
              id={nameId}
              type="text"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mon Film 01"
              className={inputClass}
            />
          </div>

          <div>
            <span className={labelClass}>Format</span>
            <div role="group" aria-label="Formats prédéfinis" className="grid grid-cols-4 gap-1 bg-gray-900 p-1 rounded-md border border-gray-800">
              {FORMAT_PRESETS.map((preset) => {
                const active = isSamePreset(draftSize, preset);
                const Icon = preset.Icon;
                return (
                  <button
                    key={preset.ratio}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { setWidth(String(preset.width)); setHeight(String(preset.height)); }}
                    title={`${preset.label} ${preset.ratio} — ${preset.width}×${preset.height}`}
                    className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded text-[10px] font-semibold uppercase tracking-wider transition-all ${
                      active
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                  >
                    <Icon size={14} />
                    <span>{preset.ratio}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor={widthId} className={labelClass}>Largeur</label>
              <input
                id={widthId}
                type="number"
                required
                min={MIN_DIMENSION}
                max={MAX_DIMENSION}
                step={2}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className={`${inputClass} tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor={heightId} className={labelClass}>Hauteur</label>
              <input
                id={heightId}
                type="number"
                required
                min={MIN_DIMENSION}
                max={MAX_DIMENSION}
                step={2}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className={`${inputClass} tabular-nums`}
              />
            </div>
            <div>
              <label htmlFor={fpsId} className={labelClass}>FPS</label>
              <select
                id={fpsId}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className={inputClass}
              >
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>{f} fps</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 leading-snug -mt-2">
            Dimensions paires entre {MIN_DIMENSION} et {MAX_DIMENSION} px.
          </p>

          <button
            type="submit"
            disabled={!canSave}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition"
          >
            <Save size={14} /> Enregistrer
          </button>

          {accessRole === 'owner' && (
          <div className="pt-3 border-t border-gray-800 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-red-400">Zone de danger</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                aria-label={confirmDelete ? 'Confirmer la suppression du projet' : 'Supprimer ce projet'}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-semibold transition border ${
                  confirmDelete
                    ? 'bg-red-600 hover:bg-red-700 border-red-600 text-white'
                    : 'bg-red-950/40 hover:bg-red-950/70 border-red-900 text-red-300'
                }`}
              >
                <Trash2 size={13} />
                {confirmDelete ? 'Confirmer la suppression' : 'Supprimer ce projet'}
              </button>
              {confirmDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-2 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition"
                >
                  Annuler
                </button>
              )}
            </div>
            <p className="text-[10px] text-gray-500 leading-snug">
              {confirmDelete
                ? 'Cette action est irréversible : clips et pistes du projet seront supprimés.'
                : 'Supprime définitivement ce projet et son contenu.'}
            </p>
          </div>
          )}
        </form>
      </div>
    </div>
  );
}
