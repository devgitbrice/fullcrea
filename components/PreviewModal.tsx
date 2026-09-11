"use client";

import { X, Film, Music, Image as ImageIcon } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { useCallback, useEffect, useRef, useState } from 'react';

const TITLE_ID = 'preview-modal-title';

// Les flux sans durée connue renvoient NaN/Infinity
const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '--:--';
  const total = Math.floor(seconds);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

export default function PreviewModal() {
  const { previewAsset, setPreviewAsset } = useProject();
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const [meta, setMeta] = useState<{ res: string; duration: string }>({
    res: '-- x --',
    duration: '--:--'
  });

  const close = useCallback(() => setPreviewAsset(null), [setPreviewAsset]);

  // Le hook doit être appelé avant le early return pour respecter les règles des hooks
  useEscapeKey(close, !!previewAsset);

  // Reset au changement de fichier
  useEffect(() => {
    setMeta({ res: 'Chargement...', duration: '...' });
  }, [previewAsset]);

  // aria-modal : déplacer le focus dans la boîte de dialogue, puis le rendre à l'élément déclencheur
  useEffect(() => {
    if (!previewAsset) return;
    const prev = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      prev?.focus();
    };
  }, [previewAsset]);

  if (!previewAsset) return null;

  const handleVideoMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    setMeta({
      res: `${v.videoWidth} x ${v.videoHeight}`,
      duration: formatDuration(v.duration)
    });
  };

  const handleAudioMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    setMeta((prev) => ({ ...prev, duration: formatDuration(e.currentTarget.duration) }));
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setMeta((prev) => ({ ...prev, res: `${img.naturalWidth} x ${img.naturalHeight}` }));
  };

  const showDimensions = previewAsset.type !== 'audio';
  const showDuration = previewAsset.type !== 'image';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-8"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden w-full max-w-5xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >

        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
          <div className="flex items-center gap-3">
             <div className="p-2 bg-gray-800 rounded-lg text-blue-400">
                {previewAsset.type === 'video' ? <Film size={20} /> : previewAsset.type === 'audio' ? <Music size={20} /> : <ImageIcon size={20} />}
             </div>
             <div>
                <h3 id={TITLE_ID} className="font-bold text-white text-lg leading-tight">{previewAsset.name}</h3>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Aperçu Source</p>
             </div>
          </div>

          {/* INFO BOX */}
          <div className="flex gap-4 text-xs font-mono text-gray-400 bg-black/30 px-4 py-2 rounded border border-gray-800">

             {showDimensions && (
               <div className="flex flex-col">
                  <span className="text-[10px] text-gray-600 uppercase">Dimensions</span>
                  <span className="text-white">{meta.res}</span>
               </div>
             )}

             {showDimensions && showDuration && (
               <div className="w-px bg-gray-700"></div>
             )}

             {showDuration && (
               <div className="flex flex-col">
                  <span className="text-[10px] text-gray-600 uppercase">Durée</span>
                  <span className="text-white">{meta.duration}</span>
               </div>
             )}

          </div>

          <div className="ml-4 flex items-center gap-3">
            <span className="text-[10px] text-gray-600 whitespace-nowrap">Échap pour fermer</span>
            <button
              ref={closeBtnRef}
              onClick={close}
              aria-label="Fermer l'aperçu"
              title="Fermer l'aperçu"
              className="p-2 hover:bg-red-500/20 hover:text-red-500 rounded-full transition"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* CONTENU */}
        <div className="flex-1 bg-black flex items-center justify-center relative overflow-hidden">

          {previewAsset.type === 'video' && (
            <video
              ref={videoRef}
              src={previewAsset.src}
              controls
              autoPlay
              className="max-w-full max-h-full shadow-2xl"
              onLoadedMetadata={handleVideoMetadata}
            />
          )}

          {previewAsset.type === 'image' && (
            <img
              src={previewAsset.src}
              alt={previewAsset.name}
              className="max-w-full max-h-full object-contain"
              onLoad={handleImageLoad}
            />
          )}

          {previewAsset.type === 'audio' && (
            <div className="flex flex-col items-center justify-center w-full h-full p-10 animate-fade-in">
                <div className="w-32 h-32 rounded-full bg-gray-800 border-4 border-gray-700 flex items-center justify-center mb-6 shadow-lg">
                    <Music size={64} className="text-green-500" />
                </div>
                <audio
                  src={previewAsset.src}
                  controls
                  autoPlay
                  className="w-full max-w-md"
                  onLoadedMetadata={handleAudioMetadata}
                />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
