"use client";

import { DragEvent, MouseEvent } from 'react';
import { FileVideo, Music, Image as ImageIcon, File, Eye } from 'lucide-react';

interface DraggableAssetProps {
  name: string;
  type: string;
  src: string;
  disabled?: boolean;
  onPreview?: () => void;
}

export default function DraggableAsset({ name, type, src, disabled = false, onPreview }: DraggableAssetProps) {
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    const payload = { isNew: true, name, type, src };
    e.dataTransfer.setData("application/react-dnd", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copy";
  };

  const handlePreviewClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onPreview?.();
  };

  const getIcon = () => {
    if (type.startsWith('video')) return <FileVideo size={18} className="text-blue-400" />;
    if (type.startsWith('audio')) return <Music size={18} className="text-green-400" />;
    if (type.startsWith('image')) return <ImageIcon size={18} className="text-purple-400" />;
    return <File size={18} className="text-gray-400" />;
  };

  return (
    <div
      draggable={!disabled}
      onDragStart={handleDragStart}
      title={disabled ? 'Bientôt disponible' : undefined}
      aria-disabled={disabled || undefined}
      className={`flex items-center gap-3 p-2 rounded group transition-colors border border-transparent select-none ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-gray-800 hover:border-gray-700 cursor-grab active:cursor-grabbing'
      }`}
    >
      {getIcon()}
      <div className={`flex-1 min-w-0 text-sm truncate text-gray-400 transition-colors ${disabled ? '' : 'group-hover:text-white'}`}>
        {name}
      </div>
      {onPreview && !disabled && (
        <button
          type="button"
          onClick={handlePreviewClick}
          aria-label="Prévisualiser"
          title="Aperçu"
          className="shrink-0 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
        >
          <Eye size={12} />
        </button>
      )}
    </div>
  );
}
