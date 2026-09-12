"use client";

import { useId, useRef, useState, ChangeEvent } from 'react';
import { X, Loader2, Music, Upload, Plus, AlertTriangle } from 'lucide-react';
import { useProject, PX_PER_SEC_BASE, type Asset } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { newId } from '@/lib/timeline/clipOps';
import { probeMediaDuration } from '@/lib/media/probe';

const INITIAL_WIDTH_PX = 150;

interface MusicPickerModalProps {
  trackId: number;
  onClose: () => void;
}

/** Piste Musique : pose un audio de la bibliothèque (ou un fichier importé) à la tête de lecture. */
export default function MusicPickerModal({ trackId, onClose }: MusicPickerModalProps) {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { assets, uploadAssetFile, setAssets, insertClipOnTrack, currentTimeRef } = useProject();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null); // id de l'asset en cours, ou 'import'
  const [error, setError] = useState<string | null>(null);

  const audioAssets = assets.filter((a) => a.type === 'audio');
  useEscapeKey(onClose, !busy);

  const placeAsset = async (asset: Asset) => {
    setError(null);
    setBusy(asset.id);
    try {
      const seconds = await probeMediaDuration(asset.src, 'audio');
      const width = seconds ? Math.max(1, seconds * PX_PER_SEC_BASE) : INITIAL_WIDTH_PX;
      insertClipOnTrack({
        id: newId('music'), name: asset.name, type: 'audio', src: asset.src,
        start: Math.max(0, currentTimeRef.current), width,
        sourceDuration: seconds ? width : undefined,
      }, trackId);
      toast({ type: 'success', message: `${asset.name} ajouté à la piste Musique` });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setBusy(null);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setError(null);
    setBusy('import');
    try {
      const asset = await uploadAssetFile(file);
      setAssets((prev) => [...prev, asset]);
      await placeAsset(asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import échoué');
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (!busy && e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md bg-gray-950 border border-gray-800 rounded-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <Music size={16} className="text-purple-400" />
            <h2 id={titleId}>Ajouter une musique</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            aria-label="Fermer"
            className="text-gray-500 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept="audio/*,.wav,.mp3,.m4a,.ogg"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!busy}
            className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition"
          >
            {busy === 'import' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Importer un fichier audio
          </button>

          <div className="text-xs font-semibold text-gray-400 uppercase pt-1">Audios de la bibliothèque</div>
          {audioAssets.length === 0 ? (
            <div className="border border-dashed border-gray-800 rounded p-3 text-center text-xs text-gray-500">
              Aucun audio dans la bibliothèque pour l&apos;instant.
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto custom-scrollbar divide-y divide-gray-800 border border-gray-800 rounded">
              {audioAssets.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-2 py-1.5">
                  <Music size={14} className="text-green-400 shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-sm text-gray-200">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => placeAsset(a)}
                    disabled={!!busy}
                    title="Poser à la tête de lecture"
                    className="shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-xs text-gray-200 disabled:opacity-50"
                  >
                    {busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    Ajouter
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div className="text-[11px] text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
              <div className="break-words leading-snug">{error}</div>
            </div>
          )}
          <div className="text-[11px] text-gray-600">Le clip est posé à la tête de lecture, à la première place libre.</div>
        </div>
      </div>
    </div>
  );
}
