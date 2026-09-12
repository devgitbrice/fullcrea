"use client";

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronDown, ChevronUp, Download, Eye, GripVertical, Loader2, Network, Pencil, Plus, Scissors, Trash2, X,
} from 'lucide-react';
import { useProject } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { OPEN_EXPORT_EVENT } from './ExportButton';
import { getSupabase, getCurrentUser } from '@/lib/supabase/client';
import { createLiveShare } from '@/lib/supabase/sharesRepo';
import { sequenceDurationPx } from '@/lib/timeline/clipOps';
import { PX_PER_SEC_BASE } from '@/lib/timeline/types';

interface Point { x: number; y: number }
interface Link { from: Point; to: Point; nested: boolean }

/** Courbe de Bézier horizontale : la carte se lit de gauche à droite. */
function curve(a: Point, b: Point): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function formatDuration(px: number): string {
  const total = Math.max(0, Math.round(px / PX_PER_SEC_BASE));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Vue mindmap horizontale : le projet à gauche, une bulle par timeline à
 * droite. Chaque bulle (y compris celle du projet) propose l'édition, une
 * visualisation dans un nouvel onglet et l'export. La bulle du projet agit sur
 * une timeline d'assemblage qui enchaîne toutes les autres dans l'ordre.
 */
export default function MindmapView({ onClose }: { onClose: () => void }) {
  const {
    currentProject, renameProject, sequences, activeSequenceId, isPersistenceCloud,
    createSequence, selectSequence, renameSequence, moveSequence, deleteSequence, buildMasterSequence,
  } = useProject();
  const { toast } = useToast();

  const canvasRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bubbleRefs = useRef(new Map<string, HTMLDivElement>());
  const sequencesRef = useRef(sequences);
  sequencesRef.current = sequences;

  const [links, setLinks] = useState<Link[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);

  // Les timelines d'assemblage ne sont pas des bulles : c'est le projet.
  // Mémoïsé : `measure` en dépend et ne doit pas se relancer à chaque rendu.
  const bubbles = useMemo(() => sequences.filter(s => !s.master), [sequences]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !renamingId) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, renamingId]);

  // Mesure des bulles pour tracer les branches (ancrages à gauche et à droite)
  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const base = canvas.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    const rootAnchor: Point = {
      x: r.right - base.left + canvas.scrollLeft,
      y: r.top - base.top + canvas.scrollTop + r.height / 2,
    };
    const anchors = new Map<string, { left: Point; right: Point }>();
    for (const seq of bubbles) {
      const el = bubbleRefs.current.get(seq.id);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      const y = b.top - base.top + canvas.scrollTop + b.height / 2;
      anchors.set(seq.id, {
        left: { x: b.left - base.left + canvas.scrollLeft, y },
        right: { x: b.right - base.left + canvas.scrollLeft, y },
      });
    }

    const next: Link[] = [];
    for (const seq of bubbles) {
      const a = anchors.get(seq.id);
      if (a) next.push({ from: rootAnchor, to: a.left, nested: false });
    }
    for (const seq of bubbles) {
      const host = anchors.get(seq.id);
      if (!host) continue;
      const refs = new Set(
        seq.clips.filter(c => c.type === 'sequence' && c.sequenceRef).map(c => c.sequenceRef!)
      );
      for (const ref of refs) {
        const target = anchors.get(ref);
        if (target) next.push({ from: host.right, to: target.left, nested: true });
      }
    }
    // Mise à jour seulement si la géométrie a bougé (évite une boucle de rendu)
    setLinks(prev => {
      if (prev.length === next.length && prev.every((l, i) =>
        l.nested === next[i].nested
        && Math.abs(l.from.x - next[i].from.x) < 0.5 && Math.abs(l.from.y - next[i].from.y) < 0.5
        && Math.abs(l.to.x - next[i].to.x) < 0.5 && Math.abs(l.to.y - next[i].to.y) < 0.5
      )) return prev;
      return next;
    });
  }, [bubbles]);

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

  const startRename = (id: string, name: string) => { setDraft(name); setRenamingId(id); };

  const commitRename = () => {
    if (!renamingId) return;
    const value = draft.trim();
    if (value) {
      if (renamingId === 'project') renameProject(currentProject.id, value);
      else renameSequence(renamingId, value);
    }
    setRenamingId(null);
  };

  // --- Actions communes aux bulles ---

  /** Édition : ouvre la timeline (ou l'assemblage pour le projet). */
  const edit = (id: string | 'project') => {
    if (id === 'project') buildMasterSequence();
    else selectSequence(id);
    onClose();
  };

  /** Export : bascule sur la timeline puis ouvre le panneau d'export. */
  const exportTimeline = (id: string | 'project') => {
    if (id === 'project') buildMasterSequence();
    else selectSequence(id);
    onClose();
    // Le panneau vit dans l'en-tête : on l'ouvre une fois la bascule faite
    setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_EXPORT_EVENT)), 60);
  };

  /**
   * Visualisation : crée un lien de partage en direct sur cette timeline et
   * l'ouvre dans un nouvel onglet. L'onglet est ouvert tout de suite pour ne
   * pas être bloqué, puis redirigé.
   */
  const visualize = async (id: string | 'project', name: string) => {
    if (!isPersistenceCloud) {
      toast({ type: 'error', message: 'La visualisation par lien nécessite Supabase (mode local actif)' });
      return;
    }
    const win = window.open('about:blank', '_blank');
    setSharing(id);
    try {
      const sequenceId = id === 'project' ? buildMasterSequence() : id;
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase indisponible');
      const user = await getCurrentUser(supabase);
      if (!user) throw new Error('Session expirée : reconnecte-toi');
      const seq = sequencesRef.current.find(s => s.id === sequenceId);
      const share = await createLiveShare(supabase, user.id, {
        projectId: currentProject.id,
        sequenceId,
        title: `${currentProject.name} — ${name}`,
        width: currentProject.projectSettings.width,
        height: currentProject.projectSettings.height,
        durationSec: sequenceDurationPx(seq?.clips ?? []) / PX_PER_SEC_BASE,
      });
      const url = `${window.location.origin}/v/${share.id}`;
      if (win) win.location.href = url;
      else window.open(url, '_blank');
      toast({ type: 'success', message: 'Lien de visualisation ouvert' });
    } catch (e) {
      win?.close();
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Visualisation impossible' });
    } finally {
      setSharing(null);
    }
  };

  const addTimeline = () => { createSequence(); onClose(); };

  const remove = (id: string, name: string) => {
    if (bubbles.length <= 1) return;
    deleteSequence(id);
    toast({ type: 'info', message: `Timeline « ${name} » supprimée` });
  };

  // Glisser vertical pour réordonner (la carte est horizontale, les bulles
  // s'empilent) ; l'ordre courant est relu à chaque déplacement.
  const handleDragStart = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || renamingId) return;
    e.preventDefault();
    setDraggingId(id);
    const onMove = (ev: PointerEvent) => {
      const order = sequencesRef.current.filter(s => !s.master);
      const current = order.findIndex(s => s.id === id);
      if (current < 0) return;
      for (let i = 0; i < order.length; i++) {
        if (i === current) continue;
        const el = bubbleRefs.current.get(order[i].id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const center = r.top + r.height / 2;
        if ((i > current && ev.clientY > center) || (i < current && ev.clientY < center)) {
          // L'index global tient compte des timelines d'assemblage masquées
          const target = sequencesRef.current.findIndex(s => s.id === order[i].id);
          moveSequence(id, target);
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

  const renameInput = (label: string) => (
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

  /** Trois actions, identiques sur la bulle projet et sur les bulles timeline. */
  const actions = (id: string | 'project', name: string) => (
    <div className="mt-2 grid grid-cols-3 gap-1">
      <button
        type="button"
        onClick={() => edit(id)}
        title={id === 'project' ? 'Éditer le montage complet (toutes les timelines à la suite)' : 'Éditer cette timeline'}
        aria-label={`Éditer ${name}`}
        className="flex items-center justify-center gap-1 rounded bg-gray-800 hover:bg-indigo-600 px-1.5 py-1.5 text-[10px] font-semibold text-gray-200 hover:text-white transition [@media(pointer:coarse)]:min-h-11"
      >
        <Scissors size={11} /> Éditer
      </button>
      <button
        type="button"
        onClick={() => visualize(id, name)}
        disabled={sharing !== null}
        title="Ouvrir un lien de visualisation dans un nouvel onglet"
        aria-label={`Visualiser ${name}`}
        className="flex items-center justify-center gap-1 rounded bg-gray-800 hover:bg-emerald-600 px-1.5 py-1.5 text-[10px] font-semibold text-gray-200 hover:text-white transition disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
      >
        {sharing === id ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />} Voir
      </button>
      <button
        type="button"
        onClick={() => exportTimeline(id)}
        title="Exporter cette timeline"
        aria-label={`Exporter ${name}`}
        className="flex items-center justify-center gap-1 rounded bg-gray-800 hover:bg-orange-600 px-1.5 py-1.5 text-[10px] font-semibold text-gray-200 hover:text-white transition [@media(pointer:coarse)]:min-h-11"
      >
        <Download size={11} /> Export
      </button>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vue mindmap du projet"
      className="fixed inset-0 z-[120] bg-gray-950 flex flex-col"
    >
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <Network size={16} className="text-indigo-400" />
          Vue mindmap
          <span className="text-[11px] font-normal text-gray-500">
            {bubbles.length} timeline{bubbles.length > 1 ? 's' : ''}
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

      <div ref={canvasRef} className="relative flex-1 overflow-auto p-8">
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

        {/* Carte horizontale : projet à gauche, timelines empilées à droite */}
        <div className="relative flex items-center gap-20 min-h-full min-w-max">
          <div
            ref={rootRef}
            data-project-bubble=""
            className="w-64 shrink-0 rounded-2xl border-2 border-indigo-500 bg-indigo-950/60 px-5 py-4 shadow-2xl shadow-indigo-900/40"
          >
            {renamingId === 'project' ? renameInput('Nom du projet') : (
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
            <p className="mt-1 text-center text-[10px] uppercase tracking-wider text-indigo-300/70">
              Projet · {bubbles.length} timeline{bubbles.length > 1 ? 's' : ''}
            </p>
            {actions('project', currentProject.name)}
            <p className="mt-1.5 text-center text-[9px] leading-snug text-gray-500">
              Agit sur le montage complet : toutes les timelines à la suite
            </p>
          </div>

          <div className="flex flex-col gap-4 shrink-0">
            {bubbles.map((seq, index) => {
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
                  className={`w-60 rounded-2xl border px-3 py-2.5 shadow-xl transition ${
                    isActive
                      ? 'border-indigo-400 bg-indigo-900/50 shadow-indigo-900/40'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-500'
                  } ${isDragging ? 'opacity-70 scale-105' : ''}`}
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
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-gray-500">{index + 1}</span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => moveSequence(seq.id, sequences.findIndex(s => s.id === bubbles[index - 1]?.id))}
                      disabled={index === 0}
                      aria-label={`Déplacer ${seq.name} vers le haut`}
                      className="shrink-0 p-1 rounded text-gray-500 hover:text-white transition disabled:opacity-30"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSequence(seq.id, sequences.findIndex(s => s.id === bubbles[index + 1]?.id))}
                      disabled={index === bubbles.length - 1}
                      aria-label={`Déplacer ${seq.name} vers le bas`}
                      className="shrink-0 p-1 rounded text-gray-500 hover:text-white transition disabled:opacity-30"
                    >
                      <ChevronDown size={13} />
                    </button>
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
                      disabled={bubbles.length <= 1}
                      title={bubbles.length <= 1 ? 'Le projet doit garder une timeline' : 'Supprimer la timeline'}
                      aria-label={`Supprimer ${seq.name}`}
                      className="shrink-0 p-1 rounded text-gray-500 hover:text-red-400 transition disabled:opacity-30 disabled:hover:text-gray-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {renamingId === seq.id ? (
                    <div className="mt-1">{renameInput('Nom de la timeline')}</div>
                  ) : (
                    <button type="button" onClick={() => edit(seq.id)} className="mt-0.5 w-full text-center">
                      <span className="block truncate text-sm font-semibold text-white">{seq.name}</span>
                      <span className="block text-[11px] text-gray-500">
                        {seq.clips.length} clip{seq.clips.length > 1 ? 's' : ''} · {formatDuration(sequenceDurationPx(seq.clips))}
                        {isActive && <span className="text-indigo-300"> · ouverte</span>}
                      </span>
                    </button>
                  )}

                  {actions(seq.id, seq.name)}
                </div>
              );
            })}

            <button
              type="button"
              onClick={addTimeline}
              className="w-60 py-4 rounded-2xl border-2 border-dashed border-gray-700 hover:border-emerald-500 hover:bg-emerald-950/20 text-gray-500 hover:text-emerald-300 flex items-center justify-center gap-2 transition"
            >
              <Plus size={16} />
              <span className="text-xs font-semibold">Nouvelle timeline</span>
            </button>
          </div>
        </div>
      </div>

      <p className="shrink-0 px-4 py-2 border-t border-gray-800 text-[11px] text-gray-600 text-center">
        Éditer ouvre la timeline · Voir ouvre un lien de visualisation dans un nouvel onglet · Export lance le rendu ·
        glissez la poignée pour réordonner
      </p>
    </div>
  );
}
