"use client";

import { DragEvent } from 'react';
import { FileVideo, Music, Image as ImageIcon, File } from 'lucide-react';

interface DraggableAssetProps {
  name: string;
  type: string;
  src: string; // <--- 1. AJOUT : On doit recevoir la source (lien/blob)
}

export default function DraggableAsset({ name, type, src }: DraggableAssetProps) { // <--- 2. AJOUT : On récupère src
  
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    // C'est ICI que le paquet est préparé
    const payload = {
      isNew: true,
      name: name,
      type: type,
      src: src // <--- 3. CRUCIAL : On transmet la source à la Timeline
    };

    console.log("Drag start:", payload); 

    e.dataTransfer.setData("application/react-dnd", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  const getIcon = () => {
    if (type.startsWith('video')) return <FileVideo size={18} className="text-blue-400" />;
    if (type.startsWith('audio')) return <Music size={18} className="text-green-400" />;
    if (type.startsWith('image')) return <ImageIcon size={18} className="text-purple-400" />;
    return <File size={18} className="text-gray-400" />;
  };

  return (
    <div 
      draggable 
      onDragStart={handleDragStart}
      className="flex items-center gap-3 p-2 hover:bg-gray-800 rounded cursor-grab active:cursor-grabbing group transition-colors border border-transparent hover:border-gray-700 select-none"
    >
      {getIcon()}
      <div className="text-sm truncate group-hover:text-white transition-colors text-gray-400">
        {name}
      </div>
    </div>
  );
}