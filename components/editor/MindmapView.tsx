"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronLeft, ChevronRight, Film, GripVertical, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { useProject } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';

interface Point { x: number; y: number }
interface Link { from: Point; to: Point; nested: boolean }

/** Courbe de Bézier verticale entre deux points (mêmes branches qu'une mindmap). */
function curve(a: Point, b: Point): string {
  const dy = Math.max(30, Math.abs(b.y - a.y) / 2);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
}

/**
 * Vue mindmap du projet : le titre au centre, une bulle par timeline. On peut
 * réordonner les bulles par glisser (ou avec les flèches), en créer une,
 * la renommer, l'ouvrir ou la supprimer. Les liens pointillés montrent les
 * timelines insérées dans une autre.
 */
export default function MindmapView({ onClose }: { onClose: () => void }) {
  const {
    currentProject, renameProject, sequences, activeSequenceId,
    createSequence, selectSequence, renameSequence, moveSequence, deleteSequence,
  } = useProject();
  const { toast } = useToast();

  const canvasRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef(new Map<string, HTMLDivElement>());
  // Ordre courant, relu pendant le glisser (la liste change à chaque déplacement)
  const sequencesRef = useRef(sequences);
  sequencesRef.current = sequences;
  const [links, setLinks] = useState<Link[]>([]);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Échap ferme la vue (les raccourcis de la timeline sont déjà neutralisés par aria-modal)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !renamingId) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, renamingId]);

  // Mesure des bulles pour tracer les branches
  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const base = canvas.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const rootAnchor: Point = {
      x: rootRect.left - base.left + rootRect.width / 2,
      y: rootRect.bottom - base.top,
    };
    const centers = new Map<string, { top: Point; bottom: Point }>();
    for (const seq of sequences) {
      const el = bubbleRefs.current.get(seq.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x = r.left - base.left + r.width / 2;
      centers.set(seq.id, {
        top: { x, y: r.top - base.top },
        bottom: { x, y: r.bottom - base.top },
      });
    }

    const next: Link[] = [];
    for (const seq of sequences) {
      const c = centers.get(seq.id);
      if (c) next.push({ from: rootAnchor, to: c.top, nested: false });
    }
    // Timelines imbriquées : lien pointillé de la timeline hôte vers l'insérée
    for (const seq of sequences) {
      const host = centers.get(seq.id);
      if (!host) continue;
      const refs = new Set(
        seq.clips.filter(c => c.type === 'sequence' && c.sequenceRef).map(c => c.sequenceRef!)
      );
      for (const ref of refs) {
        const target = centers.get(ref);
        if (target) next.push({ from: host.bottom, to: target.top, nested: true });
      }
    }
    setLinks(next);
  }, [sequences]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [measure, renamingId, draggingId]);

  const startRename = (id: string, name: string) => {
    setDraft(name);
    setRenamingId(id);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const value = draft.trim();
    if (value) {
      if (renamingId === 'project') renameProject(currentProject.id, value);
      else renameSequence(renamingId, value);
    }
    setRenamingId(null);
  };

  const open = (id: string) => {
    selectSequence(id);
    onClose();
  };

  const addTimeline = () => {
    createSequence();
    onClose();
  };

  const remove = (id: string, name: string) => {
    if (sequences.length <= 1) return;
    deleteSequence(id);
    toast({ type: 'info', message: `Timeline « ${name} » supprimée` });
  };

  // Glisser pour réordonner : la bulle survolée cède sa place dès qu'on
  // dépasse son centre (liste triable classique).
  const handleDragStart = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || renamingId) return;
    e.preventDefault();
    setDraggingId(id);

    const onMove = (ev: PointerEvent) => {
      const order = sequencesRef.current;
      const current = order.findIndex(s => s.id === id);
      if (current < 0) return;
      for (let i = 0; i < order.length; i++) {
        if (i === current) continue;
        const el = bubbleRefs.current.get(order[i].id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const inRow = ev.clientY >= r.top && ev.clientY <= r.bottom;
        if (!inRow) continue;
        const center = r.left + r.width / 2;
        if ((i > current && ev.clientX > center) || (i < current && ev.clientX < center)) {
          moveSequence(id, i);
          return;
        }
      }
    };
    const onUp = () => {
      setDraggingId(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const renameInput = (id: string, label: string) => (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitRename}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commitRename();
        if (e.key === 'Escape') setRenamingId(null);
      }}
      aria-label={label}
      className="w-full bg-gray-900 border border-indigo-500 rounded px-2 py-1 text-sm text-white text-center focus:outline-none"
    />
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vue mindmap du projet"
      className="fixed inset-0 z-[120] bg-gray-950/97 backdrop-blur-sm flex flex-col"
    >
      {/* Barre d'actions */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Film size={16} className="text-indigo-400" />
          Vue mindmap
          <span className="text-[11px] font-normal text-gray-500">
            {sequences.length} timeline{sequences.length > 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addTimeline}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition [@media(pointer:coarse)]:min-h-11"
          >
            <Plus size={14} /> Nouvelle timeline
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la vue mindmap"
            className="p-2 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition [@media(pointer:coarse)]:min-h-11"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Carte */}
      <div ref={canvasRef} className="relative flex-1 overflow-auto p-8">
        {/* Branches */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          {links.map((l, i) => (
            <path
              key={i}
              d={curve(l.from, l.to)}
              fill="none"
              stroke={l.nested ? 'rgb(129 140 248 / 0.45)' : 'rgb(99 102 241 / 0.7)'}
              strokeWidth={l.nested ? 1.5 : 2}
              strokeDasharray={l.nested ? '4 4' : undefined}
            />
          ))}
        </svg>

        <div className="relative flex flex-col items-center gap-16 min-h-full">
          {/* Titre du projet */}
          <div
            ref={rootRef}
            className="relative w-64 max-w-full rounded-2xl border-2 border-indigo-500 bg-indigo-950/60 px-5 py-4 text-center shadow-2xl shadow-indigo-900/40"
          >
            {renamingId === 'project' ? renameInput('project', 'Nom du projet') : (
              <button
                type="button"
                onClick={() => startRename('project', currentProject.name)}
                title="Renommer le projet"
                aria-label={`Renommer le projet (${currentProject.name})`}
                className="group w-full flex items-center justify-center gap-2"
              >
                <span className="truncate text-base font-bold text-white">{currentProject.name}</span>
                <Pencil size={12} className="shrink-0 text-indigo-300/60 group-hover:text-white transition" />
              </button>
            )}
            <p className="mt-1 text-[10px] uppercase tracking-wider text-indigo-300/70">Projet</p>
          </div>

          {/* Bulles = timelines */}
          <div className="flex flex-wrap items-start justify-center gap-5">
            {sequences.map((seq, index) => {
              const isActive = seq.id === activeSequenceId;
              const isDragging = seq.id === draggingId;
              return (
                <div
                  key={seq.id}
                  ref={(el) => {
                    if (el) bubbleRefs.current.set(seq.id, el);
                    else bubbleRefs.current.delete(seq.id);
                  }}
                  data-sequence-bubble={seq.id}
                  className={`relative w-52 rounded-2xl border px-3 py-3 shadow-xl transition ${
                    isActive
                      ? 'border-indigo-400 bg-indigo-900/50 shadow-indigo-900/40'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-500'
                  } ${isDragging ? 'opacity-70 scale-105 z-10' : ''}`}
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onPointerDown={(e) => handleDragStart(e, seq.id)}
                      title="Glisser pour réordonner"
                      aria-label={`Déplacer ${seq.name}`}
                      className="shrink-0 p-1 rounded text-gray-500 hover:text-white cursor-grab active:cursor-grabbing touch-none"
                    >
                      <GripVertical size={14} />
                    </button>
                    <span className="flex-1 min-w-0 text-center text-[10px] uppercase tracking-wider text-gray-500">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => startRename(seq.id, seq.name)}
                      title="Renommer la timeline"
                      aria-label={`Renommer ${seq.name}`}
                      className="shrink-0 p-1 rounded text-gray-500 hover:text-white transition"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(seq.id, seq.name)}
                      disabled={sequences.length <= 1}
                      title={sequences.length <= 1 ? 'Le projet doit garder une timeline' : 'Supprimer la timeline'}
                      aria-label={`Supprimer ${seq.name}`}
                      className="shrink-0 p-1 rounded text-gray-500 hover:text-red-400 transition disabled:opacity-30 disabled:hover:text-gray-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {renamingId === seq.id ? (
                    <div className="mt-2">{renameInput(seq.id, 'Nom de la timeline')}</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => open(seq.id)}
                      title="Ouvrir cette timeline"
                      className="mt-1 w-full text-center"
                    >
                      <span className="block truncate text-sm font-semibold text-white">{seq.name}</span>
                      <span className="block text-[11px] text-gray-500">
                        {seq.clips.length} clip{seq.clips.length > 1 ? 's' : ''}
                        {isActive && <span className="text-indigo-300"> · ouverte</span>}
                      </span>
                    </button>
                  )}

                  {/* Réordonner sans glisser (clavier, tactile) */}
                  <div className="mt-2 flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveSequence(seq.id, index - 1)}
                      disabled={index === 0}
                      aria-label={`Déplacer ${seq.name} vers la gauche`}
                      className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition disabled:opacity-30"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => open(seq.id)}
                      className="flex-1 rounded bg-gray-800 hover:bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-gray-200 hover:text-white transition [@media(pointer:coarse)]:min-h-11"
                    >
                      Ouvrir
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSequence(seq.id, index + 1)}
                      disabled={index === sequences.length - 1}
                      aria-label={`Déplacer ${seq.name} vers la droite`}
                      className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition disabled:opacity-30"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Bulle d'ajout */}
            <button
              type="button"
              onClick={addTimeline}
              className="w-52 min-h-[7rem] rounded-2xl border-2 border-dashed border-gray-700 hover:border-emerald-500 hover:bg-emerald-950/20 text-gray-500 hover:text-emerald-300 flex flex-col items-center justify-center gap-2 transition"
            >
              <Plus size={20} />
              <span className="text-xs font-semibold">Nouvelle timeline</span>
            </button>
          </div>

          <p className="text-[11px] text-gray-600 pb-4">
            Cliquez une bulle pour ouvrir la timeline · glissez la poignée pour réordonner ·
            les liens pointillés indiquent une timeline insérée dans une autre
          </p>
        </div>
      </div>
    </div>
  );
}
