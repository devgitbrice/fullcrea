"use client";

import { useRef, ChangeEvent, useState } from 'react';
import {
  Upload,
  Video,
  Monitor,
  Piano,
  Wand2,
  FolderOpen,
  AlertTriangle,
  Cloud,
  CloudOff,
  HardDrive,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import DraggableAsset from './DraggableAsset';
import ProjectSelector from './ProjectSelector';
import { CreationSection } from './CreationModals';
import RecorderModal, { RecorderMode } from './RecorderModal';
import { useProject } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';

const SIDEBAR_COLLAPSED_KEY = 'fullcrea_sidebar_collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    // localStorage indisponible (navigation privée, quota) : l'état reste en mémoire seulement
  }
}

export default function Sidebar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [recorderMode, setRecorderMode] = useState<RecorderMode | null>(null);
  const { toast } = useToast();

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

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setIsUploading(true);
    try {
      const asset = await uploadAssetFile(file);
      setAssets((prev) => [...prev, asset]);
      toast({ type: 'success', message: `${file.name} ajouté à la bibliothèque` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      console.error('[fullcrea] Import échoué', e);
      toast({ type: 'error', message: `Import échoué : ${msg}` });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      className={`${collapsed ? 'w-12' : 'w-64'} bg-gray-950 border-r border-gray-800 flex flex-col h-full text-gray-300 shrink-0 select-none overflow-hidden transition-[width] duration-200`}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,video/*,audio/*,.wav,.mp3"
      />

      {collapsed ? (
        /* --- RAIL RÉDUIT --- */
        <div className="flex flex-col items-center gap-2 p-2">
          <button
            onClick={toggleCollapsed}
            title="Afficher la bibliothèque"
            aria-label="Afficher la bibliothèque"
            aria-expanded={false}
            className="p-2 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition"
          >
            <PanelLeftOpen size={16} />
          </button>
          <button
            onClick={handleImportClick}
            disabled={isUploading}
            title={isUploading ? 'Import en cours…' : 'Importer Média'}
            aria-label="Importer Média"
            className="p-2 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white transition shadow-lg shadow-blue-900/20"
          >
            {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          </button>
          <button
            onClick={() => setRecorderMode('camera')}
            title="Enregistrer une vidéo (webcam ou iPhone)"
            aria-label="Enregistrer une vidéo"
            className="p-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
          >
            <Video size={16} />
          </button>
          <button
            onClick={() => setRecorderMode('screen')}
            title="Enregistrer l'écran"
            aria-label="Enregistrer l'écran"
            className="p-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
          >
            <Monitor size={16} />
          </button>
        </div>
      ) : (
        /* Largeur fixe pour éviter le reflow du contenu pendant la transition */
        <div className="w-64 flex flex-col flex-1 min-h-0">

          {/* --- HEADER SIDEBAR --- */}
          <div className="p-4 border-b border-gray-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="font-bold text-white text-lg tracking-tight truncate">Gennn Cut</h1>
              <div className="flex items-center gap-1.5 shrink-0">
                <PersistenceBadge mode={persistenceMode} />
                <button
                  onClick={toggleCollapsed}
                  title="Réduire la bibliothèque"
                  aria-label="Réduire la bibliothèque"
                  aria-expanded
                  className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition"
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
            </div>

            <ProjectSelector />

            <div className="space-y-1">
              <button
                onClick={handleImportClick}
                disabled={isUploading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition shadow-lg shadow-blue-900/20"
              >
                <Upload size={16} />
                {isUploading ? 'Import en cours…' : 'Importer Média'}
              </button>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => setRecorderMode('camera')}
                  title="Webcam ou iPhone connecté"
                  className="flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 py-2 rounded text-xs font-medium transition"
                >
                  <Video size={14} />
                  Vidéo
                </button>
                <button
                  onClick={() => setRecorderMode('screen')}
                  title="Enregistrer ce qui s'affiche à l'écran"
                  className="flex items-center justify-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 py-2 rounded text-xs font-medium transition"
                >
                  <Monitor size={14} />
                  Écran
                </button>
              </div>
              <div className="text-[10px] text-gray-600 text-center">
                Glissez un média sur la timeline, ou « + » pour l&apos;insérer
              </div>
            </div>

            <CreationSection />

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
              <div className="text-[11px] text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
                <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
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
          <div className="flex-1 overflow-y-auto p-2 space-y-6 custom-scrollbar" style={{ touchAction: 'pan-y' }}>

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
                    <DraggableAsset
                      name={asset.name}
                      type={asset.type}
                      src={asset.src}
                      onPreview={() => setPreviewAsset(asset)}
                    />
                  </div>
                ))}
                {assets.length === 0 && (
                  <div className="border border-dashed border-gray-800 rounded p-3 text-center text-xs text-gray-500 mx-1">
                    <Upload size={16} className="mx-auto mb-1.5 text-gray-600" />
                    <div className="font-medium text-gray-400">Aucun média</div>
                    <div className="text-[11px] text-gray-600 mt-0.5 leading-snug">
                      Importez un fichier ou créez-en un avec l&apos;IA ci-dessous
                    </div>
                  </div>
                )}
              </div>
            </div>


            {currentView === 'music' && (
              <div className="animate-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-2 text-xs font-semibold text-purple-400 uppercase px-2 mb-2 pt-2 border-t border-gray-800/50">
                  <Piano size={12} /> Instruments <ComingSoonBadge />
                </div>
                <div className="space-y-1">
                  {instruments.map((inst, i) => (
                    <DraggableAsset key={`inst_${i}`} name={inst.name} type="audio" src={inst.src} disabled />
                  ))}
                </div>
              </div>
            )}

            {(currentView === 'music' || currentView === 'podcast') && (
              <div className="animate-in slide-in-from-left-4 duration-300 delay-75">
                <div className="flex items-center gap-2 text-xs font-semibold text-orange-400 uppercase px-2 mb-2 pt-2 border-t border-gray-800/50">
                  <Wand2 size={12} /> Effets Audio <ComingSoonBadge />
                </div>
                <div className="space-y-1">
                  {effects.map((fx, i) => (
                    <DraggableAsset key={`fx_${i}`} name={fx.name} type="audio" src={fx.src} disabled />
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {recorderMode && (
        <RecorderModal mode={recorderMode} onClose={() => setRecorderMode(null)} />
      )}
    </div>
  );
}

function ComingSoonBadge() {
  return (
    <span className="text-[9px] uppercase bg-gray-800 text-gray-400 rounded px-1">Bientôt</span>
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
