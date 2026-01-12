"use client";

import { useState, useRef, ChangeEvent } from 'react';
import { Upload, Piano, Wand2, FolderOpen } from 'lucide-react'; // Ajout d'icônes pour les sections
import DraggableAsset from './DraggableAsset'; 
import { useProject, Asset } from '@/components/ProjectContext'; 

export default function Sidebar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // On récupère currentView pour savoir quoi afficher
  const { setPreviewAsset, currentView } = useProject(); 
  
  // --- DONNÉES UTILISATEUR (Fichiers importés) ---
  const [assets, setAssets] = useState<Asset[]>([
    { 
      id: 'asset_1', 
      name: 'rush_vacances.mp4', 
      type: 'video', 
      src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' 
    },
    { 
      id: 'asset_2', 
      name: 'background_loop.mp3', 
      type: 'audio', 
      src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' 
    },
    { 
      id: 'asset_3', 
      name: 'logo_final.png', 
      type: 'image', 
      src: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=1000&q=80' 
    },
  ]);

  // --- DONNÉES FACTICES (Pour l'exemple Music/Podcast) ---
  // Note: On met src="" pour l'instant car ce sont des presets
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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      let type: 'video' | 'audio' | 'image' = 'image';
      
      if (file.type.startsWith('video')) type = 'video';
      else if (file.type.startsWith('audio')) type = 'audio';

      const objectUrl = URL.createObjectURL(file);

      setAssets((prev) => [
        ...prev, 
        { 
          id: `imported_${Date.now()}`,
          name: file.name, 
          type: type,
          src: objectUrl 
        }
      ]);
    }
  };

  return (
    <div className="w-64 bg-gray-950 border-r border-gray-800 flex flex-col h-full text-gray-300 shrink-0 select-none">
      
      {/* --- HEADER SIDEBAR --- */}
      <div className="p-4 border-b border-gray-800">
        <h1 className="font-bold text-white mb-4 text-xl tracking-tight">Studio Next</h1>
        
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
          className="hidden" 
          accept="image/*,video/*,audio/*,.wav,.mp3"
        />
        
        <button 
          onClick={handleImportClick} 
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-sm font-medium transition shadow-lg shadow-blue-900/20"
        >
          <Upload size={16} /> Importer Média
        </button>
      </div>
      
      {/* --- CONTENU SCROLLABLE --- */}
      <div className="flex-1 overflow-y-auto p-2 space-y-6 custom-scrollbar">
        
        {/* SECTION 1 : BIBLIOTHÈQUE (Toujours visible) */}
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
                    />
                </div>
                ))}
                {assets.length === 0 && (
                    <div className="text-center text-xs text-gray-700 mt-4 italic">Vide</div>
                )}
            </div>
        </div>

        {/* SECTION 2 : INSTRUMENTS (Visible en mode MUSIC uniquement) */}
        {currentView === 'music' && (
           <div className="animate-in slide-in-from-left-4 duration-300">
             <div className="flex items-center gap-2 text-xs font-semibold text-purple-400 uppercase px-2 mb-2 pt-2 border-t border-gray-800/50">
               <Piano size={12} /> Instruments
             </div>
             <div className="space-y-1">
               {instruments.map((inst, i) => (
                 // On utilise DraggableAsset même pour les presets (src vide pour l'instant)
                 <DraggableAsset key={`inst_${i}`} name={inst.name} type="audio" src={inst.src} />
               ))}
             </div>
           </div>
        )}

        {/* SECTION 3 : EFFETS (Visible en mode MUSIC ou PODCAST) */}
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
    </div>
  );
}