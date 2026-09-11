"use client";

import { DragEvent, MouseEvent, PointerEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileVideo, Music, Image as ImageIcon, File, Eye, Plus } from 'lucide-react';
import {
  emitAssetAdd,
  emitAssetDrop,
  isOverTimeline,
} from '@/lib/assetDrag';

interface DraggableAssetProps {
  name: string;
  type: string;
  src: string;
  disabled?: boolean;
  onPreview?: () => void;
}

/** Distance (px) au-delà de laquelle un mouvement devient un drag. */
const DRAG_THRESHOLD_PX = 6;

export default function DraggableAsset({ name, type, src, disabled = false, onPreview }: DraggableAssetProps) {
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const draggingRef = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; over: boolean } | null>(null);

  // Le ghost est rendu dans un portal : on attend le montage client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const endDrag = () => {
    origin.current = null;
    draggingRef.current = false;
    setGhost(null);
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    origin.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    // La capture garantit qu'on reçoit move/up même quand le pointeur quitte
    // la sidebar pour survoler la timeline.
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start || start.pointerId !== e.pointerId) return;

    if (!draggingRef.current) {
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (moved < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
    }
    // Empêche le scroll tactile de la bibliothèque pendant le glisser.
    if (e.cancelable) e.preventDefault();
    setGhost({ x: e.clientX, y: e.clientY, over: isOverTimeline(e.clientX, e.clientY) });
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    const wasDragging = draggingRef.current;
    if (start?.pointerId === e.pointerId) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    endDrag();
    if (!wasDragging) return;
    if (isOverTimeline(e.clientX, e.clientY)) {
      emitAssetDrop({ name, type, src, clientX: e.clientX, clientY: e.clientY });
    }
  };

  // Drag HTML5 conservé pour les navigateurs desktop où il fonctionne :
  // il apporte le curseur natif et le dépôt depuis une autre fenêtre.
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    // Un drag natif prend le relais : on annule le drag pointeur en cours pour
    // ne pas insérer le clip deux fois.
    endDrag();
    const payload = { isNew: true, name, type, src };
    const json = JSON.stringify(payload);
    e.dataTransfer.setData('application/react-dnd', json);
    // Safari n'expose pas toujours les types MIME personnalisés au drop.
    e.dataTransfer.setData('text/plain', json);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handlePreviewClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onPreview?.();
  };

  const handleAddClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    emitAssetAdd({ name, type, src });
  };

  const getIcon = () => {
    if (type.startsWith('video')) return <FileVideo size={18} className="text-blue-400" />;
    if (type.startsWith('audio')) return <Music size={18} className="text-green-400" />;
    if (type.startsWith('image')) return <ImageIcon size={18} className="text-purple-400" />;
    return <File size={18} className="text-gray-400" />;
  };

  return (
    <>
      <div
        draggable={!disabled}
        onDragStart={handleDragStart}
        onDragEnd={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={endDrag}
        title={disabled ? 'Bientôt disponible' : 'Glissez sur la timeline (ou + pour insérer à la tête de lecture)'}
        aria-disabled={disabled || undefined}
        // pan-y : le scroll vertical de la bibliothèque reste possible au doigt,
        // le mouvement horizontal démarre le glisser.
        style={disabled ? undefined : { touchAction: 'pan-y', WebkitUserDrag: 'element' } as React.CSSProperties}
        className={`flex items-center gap-3 p-2 rounded group transition-colors border border-transparent select-none ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:bg-gray-800 hover:border-gray-700 cursor-grab active:cursor-grabbing'
        } ${ghost ? 'opacity-50' : ''}`}
      >
        {getIcon()}
        <div className={`flex-1 min-w-0 text-sm truncate text-gray-400 transition-colors ${disabled ? '' : 'group-hover:text-white'}`}>
          {name}
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={handleAddClick}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Ajouter à la timeline"
            title="Ajouter à la timeline (tête de lecture)"
            className="shrink-0 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
          >
            <Plus size={12} />
          </button>
        )}
        {onPreview && !disabled && (
          <button
            type="button"
            onClick={handlePreviewClick}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="Prévisualiser"
            title="Aperçu"
            className="shrink-0 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
          >
            <Eye size={12} />
          </button>
        )}
      </div>

      {/* Vignette qui suit le pointeur pendant le glisser */}
      {mounted && ghost && createPortal(
        <div
          className={`fixed z-[200] pointer-events-none flex items-center gap-2 px-2 py-1 rounded border text-xs shadow-xl ${
            ghost.over
              ? 'bg-blue-600 border-blue-400 text-white'
              : 'bg-gray-900 border-gray-700 text-gray-300'
          }`}
          style={{ left: ghost.x + 12, top: ghost.y + 12, maxWidth: 200 }}
        >
          {getIcon()}
          <span className="truncate">{name}</span>
        </div>,
        document.body,
      )}
    </>
  );
}
