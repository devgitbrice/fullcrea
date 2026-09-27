"use client";

import { DragEvent, PointerEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Blend } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { emitTransitionDrop, isOverTimeline } from '@/lib/assetDrag';
import { DEFAULT_TRANSITION_PX, TRANSITION_PALETTE, type TransitionType } from '@/lib/timeline/types';

/** Distance (px) au-delà de laquelle un mouvement devient un glisser. */
const DRAG_THRESHOLD_PX = 6;

/**
 * Aperçu miniature de la transition : image A (bleue) → image B (rose).
 * Animation CSS en boucle, pour voir l'effet avant de le déposer.
 */
function TransitionThumb({ type }: { type: TransitionType }) {
  return (
    <div className="relative w-full aspect-video rounded overflow-hidden bg-black" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-br from-sky-500 to-blue-800" />
      {type === 'fade' && <div className="absolute inset-0 bg-black fx-thumb-black" />}
      <div className={`absolute inset-0 bg-gradient-to-br from-pink-400 to-fuchsia-700 fx-thumb-${type}`} />
    </div>
  );
}

function TransitionTile({ type, label }: { type: TransitionType; label: string }) {
  const { clips, setClips, selectedClipId } = useProject();
  const { toast } = useToast();
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const draggingRef = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; over: boolean } | null>(null);

  const endDrag = () => {
    origin.current = null;
    draggingRef.current = false;
    setGhost(null);
  };

  // Clic (sans glisser) : appliquée au visuel sélectionné, s'il y en a un
  const applyToSelection = () => {
    const target = clips.find(c => c.id === selectedClipId);
    if (!target || (target.type !== 'image' && target.type !== 'video')) {
      toast({ type: 'info', message: 'Glissez la transition entre deux images de la timeline' });
      return;
    }
    const duration = Math.min(DEFAULT_TRANSITION_PX, target.width / 2);
    setClips(prev => prev.map(c => (c.id === target.id ? { ...c, transition: { type, duration } } : c)));
    toast({ type: 'success', message: `Transition « ${label} » ajoutée à ${target.name}` });
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    origin.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start || start.pointerId !== e.pointerId) return;
    if (!draggingRef.current) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      draggingRef.current = true;
    }
    if (e.cancelable) e.preventDefault();
    setGhost({ x: e.clientX, y: e.clientY, over: isOverTimeline(e.clientX, e.clientY) });
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    const wasDragging = draggingRef.current;
    if (start?.pointerId === e.pointerId) e.currentTarget.releasePointerCapture?.(e.pointerId);
    endDrag();
    if (!start) return;
    if (!wasDragging) {
      applyToSelection();
      return;
    }
    if (isOverTimeline(e.clientX, e.clientY)) {
      emitTransitionDrop({ type, clientX: e.clientX, clientY: e.clientY });
    }
  };

  // Drag HTML5 (navigateurs de bureau) : reçu par le onDrop de la timeline
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    endDrag();
    const json = JSON.stringify({ kind: 'transition', transition: type });
    e.dataTransfer.setData('application/react-dnd', json);
    e.dataTransfer.setData('text/plain', json);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={endDrag}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') applyToSelection(); }}
        title="Glissez entre deux images de la timeline (ou cliquez pour l'appliquer à l'image sélectionnée)"
        aria-label={`Transition ${label}`}
        style={{ touchAction: 'pan-y' }}
        className="group flex flex-col gap-1 p-1.5 rounded-md bg-gray-900 border border-gray-800 hover:border-pink-500/70 cursor-grab active:cursor-grabbing select-none transition"
      >
        <TransitionThumb type={type} />
        <span className="text-[11px] text-gray-300 group-hover:text-white truncate text-center">{label}</span>
      </div>

      {ghost && typeof document !== 'undefined' && createPortal(
        <div
          className={`fixed z-[1000] pointer-events-none -translate-x-1/2 -translate-y-1/2 px-2 py-1 rounded text-xs font-semibold shadow-xl border ${
            ghost.over ? 'bg-pink-600 border-pink-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-300'
          }`}
          style={{ left: ghost.x, top: ghost.y }}
        >
          {label}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Section « Transitions » de la bibliothèque, sous les fichiers du projet. */
export default function TransitionLibrary() {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold text-pink-400 uppercase px-2 mb-2 pt-2 border-t border-gray-800/50">
        <Blend size={12} /> Transitions
      </div>
      <div className="grid grid-cols-2 gap-1.5 px-1">
        {TRANSITION_PALETTE.map(t => (
          <TransitionTile key={t.id} type={t.id} label={t.label} />
        ))}
      </div>
      <p className="text-[10px] text-gray-600 leading-snug px-2 mt-2">
        Glissez une transition entre deux images de la timeline.
      </p>
    </div>
  );
}
