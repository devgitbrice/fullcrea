"use client";

import { X, Film, Music, Image as ImageIcon } from 'lucide-react';
// Utilise l'alias @ pour être sûr du chemin
import { useProject } from '@/components/ProjectContext'; 
import { useEffect, useRef, useState } from 'react';

export default function PreviewModal() {
  const { previewAsset, setPreviewAsset } = useProject();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // 1. On ajoute 'fps' à notre état local
  const [meta, setMeta] = useState<{ res: string; duration: string; fps: string }>({ 
    res: '-- x --', 
    duration: '--:--', 
    fps: '--' 
  });

  // Reset au changement de fichier
  useEffect(() => {
    setMeta({ res: 'Chargement...', duration: '...', fps: '...' });
  }, [previewAsset]);

  if (!previewAsset) return null;

  // 2. Calcul des métadonnées Vidéo
  const handleMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    const durationSec = Math.floor(v.duration);
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    
    // NOTE : Les navigateurs ne donnent pas le FPS natif facilement.
    // Pour une vraie app pro, on utiliserait 'mediainfo.js'. 
    // Ici, on simule une valeur standard (30 FPS) pour l'affichage.
    const detectedFps = "30"; 

    setMeta({
      res: `${v.videoWidth} x ${v.videoHeight}`,
      duration: `${min}:${sec.toString().padStart(2, '0')}`,
      fps: detectedFps
    });
  };

  // 3. Calcul pour les Images (Pas de FPS)
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setMeta({
      res: `${img.naturalWidth} x ${img.naturalHeight}`,
      duration: '00:05', // Durée par défaut pour une image
      fps: '0' // Une image n'a pas de FPS
    });
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-8"
      onClick={() => setPreviewAsset(null)}
    >
      <div 
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
                <h3 className="font-bold text-white text-lg leading-tight">{previewAsset.name}</h3>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Aperçu Source</p>
             </div>
          </div>
          
          {/* INFO BOX (Mise à jour avec FPS) */}
          <div className="flex gap-4 text-xs font-mono text-gray-400 bg-black/30 px-4 py-2 rounded border border-gray-800">
             
             {/* Résolution */}
             <div className="flex flex-col">
                <span className="text-[10px] text-gray-600 uppercase">Dimensions</span>
                <span className="text-white">{meta.res}</span>
             </div>
             
             <div className="w-px bg-gray-700"></div>
             
             {/* Durée */}
             <div className="flex flex-col">
                <span className="text-[10px] text-gray-600 uppercase">Durée</span>
                <span className="text-white">{meta.duration}</span>
             </div>

             {/* NOUVEAU : FPS (Seulement si c'est une vidéo) */}
             {previewAsset.type === 'video' && (
               <>
                 <div className="w-px bg-gray-700"></div>
                 <div className="flex flex-col">
                    <span className="text-[10px] text-gray-600 uppercase">Images/s</span>
                    <span className="text-green-400 font-bold">{meta.fps} FPS</span>
                 </div>
               </>
             )}

          </div>

          <button onClick={() => setPreviewAsset(null)} className="ml-4 p-2 hover:bg-red-500/20 hover:text-red-500 rounded-full transition">
            <X size={24} />
          </button>
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
              onLoadedMetadata={handleMetadata} // Déclencheur des infos
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
                />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}