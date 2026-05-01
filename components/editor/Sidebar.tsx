"use client";

import { useRef, ChangeEvent, useState } from 'react';
import { Upload, Piano, Wand2, FolderOpen, AlertTriangle, Cloud, CloudOff, HardDrive, X, LogOut } from 'lucide-react';
import DraggableAsset from './DraggableAsset';
import ProjectSelector from './ProjectSelector';
import { CreationSection } from './CreationModals';
import { useProject } from '@/components/ProjectContext';
import { getSupabase } from '@/lib/supabase/client';

export default function Sidebar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const {
    setPreviewAsset,
    currentView,
    assets,
    setAssets,
    uploadAssetFile,
    persistenceMode,
    persistenceError,
  } = useProject();

  const instruments = [
    { name: 'Piano Grand', type: 'audio', src: '' },
    { name: 'Synthwave Bass', type: 'audio', src: '' },
    { name: 'Drum Kit 808', type: 'audio', src: '' },
  ];

  const effects = [
    { name: 'Reverb Hall', type: 'audio', src: '' },
    { name: 'Delay PingPong', type: 'audio', src: '' },
    { name: 'Compressor', type: 'audio', src: '' },
    { name: 'EQ 3-Band', type: 'audio', src: '' },
  ];

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setUploadError(null);
    setIsUploading(true);
    try {
      const asset = await uploadAssetFile(file);
      setAssets((prev) => [...prev, asset]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      setUploadError(msg);
      console.error('[fullcrea] Import échoué', e);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col h-full text-gray-300 shrink-0 select-none">

      {/* --- HEADER SIDEBAR --- */}
      <div className="p-4 border-b border-gray-800 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="font-bold text-white text-lg tracking-tight">Studio Next</h1>
          <PersistenceBadge mode={persistenceMode} />
        </div>

        <ProjectSelector />

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="image/*,video/*,audio/*,.wav,.mp3"
        />

        <button
          onClick={handleImportClick}
          disabled={isUploading}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition shadow-lg shadow-blue-900/20"
        >
          <Upload size={16} />
          {isUploading ? 'Import en cours…' : 'Importer Média'}
        </button>

        {/* Bandeau d'erreur d'upload */}
        {uploadError && (
          <div className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-red-200 mb-0.5">Import échoué</div>
              <div className="break-words">{uploadError}</div>
            </div>
            <button
              onClick={() => setUploadError(null)}
              className="text-red-400 hover:text-red-200 shrink-0"
              title="Fermer"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Bandeau d'avertissement persistance dégradée */}
        {persistenceMode === 'local-fallback' && (
          <div className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-900 rounded p-2 flex items-start gap-2">
            <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber-400" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-amber-200 mb-0.5">Supabase configuré mais inactif</div>
              <div className="break-words leading-snug">
                {persistenceError ?? 'Sauvegarde en local seulement.'}
              </div>
            </div>
          </div>
        )}

        {/* Erreur de sauvegarde DB (mode cloud actif mais une write a échoué) */}
        {persistenceMode === 'cloud' && persistenceError && (
          <div className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-red-200 mb-0.5">Sauvegarde DB échouée</div>
              <div className="break-words leading-snug">{persistenceError}</div>
            </div>
          </div>
        )}

        {/* Mode local pur (pas de Supabase configuré) — info subtile sur les imports */}
        {persistenceMode === 'local' && (
          <div className="text-[11px] text-gray-500 leading-snug">
            Mode local : les fichiers importés ne survivent pas à un reload.
          </div>
        )}
      </div>

      {/* --- CONTENU SCROLLABLE --- */}
      <div className="flex-1 overflow-y-auto p-2 space-y-6 custom-scrollbar">

        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase px-2 mb-2">
            <FolderOpen size={12} /> Fichiers Projet
          </div>
          <div className="space-y-1">
            {assets.map((asset) => (
              <div
                key={asset.id}
                onDoubleClick={() => setPreviewAsset(asset)}
                title="Double-cliquez pour prévisualiser"
              >
                <DraggableAsset name={asset.name} type={asset.type} src={asset.src} />
              </div>
            ))}
            {assets.length === 0 && (
              <div className="text-center text-xs text-gray-700 mt-4 italic">Vide</div>
            )}
          </div>
        </div>

        <CreationSection />

        {currentView === 'music' && (
          <div className="animate-in slide-in-from-left-4 duration-300">
            <div className="flex items-center gap-2 text-xs font-semibold text-purple-400 uppercase px-2 mb-2 pt-2 border-t border-gray-800/50">
              <Piano size={12} /> Instruments
            </div>
            <div className="space-y-1">
              {instruments.map((inst, i) => (
                <DraggableAsset key={`inst_${i}`} name={inst.name} type="audio" src={inst.src} />
              ))}
            </div>
          </div>
        )}

        {(currentView === 'music' || currentView === 'podcast') && (
          <div className="animate-in slide-in-from-left-4 duration-300 delay-75">
            <div className="flex items-center gap-2 text-xs font-semibold text-orange-400 uppercase px-2 mb-2 pt-2 border-t border-gray-800/50">
              <Wand2 size={12} /> Effets Audio
            </div>
            <div className="space-y-1">
              {effects.map((fx, i) => (
                <DraggableAsset key={`fx_${i}`} name={fx.name} type="audio" src={fx.src} />
              ))}
            </div>
          </div>
        )}

      </div>

      {/* --- FOOTER : déconnexion --- */}
      {persistenceMode === 'cloud' && (
        <div className="border-t border-gray-800 p-2">
          <button
            onClick={async () => {
              const client = getSupabase();
              if (client) await client.auth.signOut();
            }}
            className="w-full flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-white hover:bg-gray-900 py-2 rounded transition"
          >
            <LogOut size={12} /> Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function PersistenceBadge({ mode }: { mode: 'cloud' | 'local' | 'local-fallback' }) {
  if (mode === 'cloud') {
    return (
      <span
        className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-900 rounded-full px-2 py-0.5"
        title="Sauvegarde Supabase active"
      >
        <Cloud size={10} /> Cloud
      </span>
    );
  }
  if (mode === 'local-fallback') {
    return (
      <span
        className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-950/40 border border-amber-900 rounded-full px-2 py-0.5"
        title="Supabase configuré mais inactif — fallback local"
      >
        <CloudOff size={10} /> Local
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 bg-gray-900 border border-gray-800 rounded-full px-2 py-0.5"
      title="Sauvegarde dans le navigateur (localStorage)"
    >
      <HardDrive size={10} /> Local
    </span>
  );
}
