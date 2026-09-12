"use client";

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Film, Pencil, Plus, Trash2, CornerDownRight } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { wouldCreateCycle } from '@/lib/timeline/clipOps';

/**
 * Sélecteur de timeline du projet : bascule entre les timelines, en crée,
 * les renomme, les supprime, et insère une autre timeline dans la timeline
 * courante sous forme de clip (timeline imbriquée).
 */
export default function SequenceSelector() {
  const {
    sequences, activeSequenceId, createSequence, selectSequence, renameSequence,
    deleteSequence, insertSequenceClip, currentTimeRef, selectClip,
  } = useProject();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = sequences.find(s => s.id === activeSequenceId) ?? sequences[0];

  // Fermeture au clic extérieur (phase capture : avant les handlers de la timeline)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => { if (renaming) inputRef.current?.select(); }, [renaming]);
  useEffect(() => { if (!open) setRenaming(false); }, [open]);

  const startRename = () => {
    setDraft(active?.name ?? '');
    setRenaming(true);
  };

  const commitRename = () => {
    if (draft.trim()) renameSequence(activeSequenceId, draft);
    setRenaming(false);
  };

  const handleInsert = (id: string) => {
    const clipId = insertSequenceClip(id, Math.max(0, currentTimeRef.current));
    setOpen(false);
    if (!clipId) {
      toast({ type: 'error', message: 'Insertion impossible : cette timeline contient déjà la timeline courante' });
      return;
    }
    selectClip(clipId, 'replace');
    toast({ type: 'success', message: 'Timeline insérée à la tête de lecture' });
  };

  const handleDelete = () => {
    if (sequences.length <= 1) return;
    const name = active?.name;
    deleteSequence(activeSequenceId);
    setOpen(false);
    toast({ type: 'info', message: `Timeline « ${name} » supprimée` });
  };

  const itemClass =
    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs text-gray-200 ' +
    'hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed [@media(pointer:coarse)]:min-h-11';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Timeline du projet : ${active?.name ?? ''}`}
        title="Timeline du projet (changer, créer, insérer)"
        className="flex items-center gap-1.5 max-w-[11rem] px-2 py-1.5 rounded text-xs font-medium text-gray-200 bg-gray-900 border border-gray-800 hover:bg-gray-800 transition [@media(pointer:coarse)]:min-h-11"
      >
        <Film size={14} className="shrink-0 text-indigo-400" />
        <span className="truncate">{active?.name ?? 'Timeline'}</span>
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Timelines du projet"
          className="absolute left-0 top-full mt-1 z-[90] w-64 bg-gray-950 border border-gray-800 rounded-lg shadow-2xl p-1.5 space-y-1"
        >
          <div className="px-2 pt-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
            Timelines du projet
          </div>
          <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-0.5">
            {sequences.map(seq => (
              <button
                key={seq.id}
                type="button"
                role="menuitem"
                onClick={() => { selectSequence(seq.id); setOpen(false); }}
                className={itemClass}
              >
                <Check size={12} className={`shrink-0 ${seq.id === activeSequenceId ? 'text-indigo-400' : 'opacity-0'}`} />
                <span className="flex-1 min-w-0 truncate">{seq.name}</span>
                <span className="shrink-0 text-[10px] text-gray-600">{seq.clips.length} clip{seq.clips.length > 1 ? 's' : ''}</span>
              </button>
            ))}
          </div>

          <div className="border-t border-gray-800 pt-1 space-y-0.5">
            {renaming ? (
              <div className="flex items-center gap-1 px-1">
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Entrée valide et referme le menu ; un clic ailleurs valide sans fermer
                    if (e.key === 'Enter') { commitRename(); setOpen(false); }
                    if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false); }
                  }}
                  onBlur={commitRename}
                  aria-label="Nom de la timeline"
                  className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <button type="button" role="menuitem" onClick={startRename} className={itemClass}>
                <Pencil size={12} className="shrink-0 text-gray-400" /> Renommer cette timeline
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => { createSequence(); setOpen(false); }}
              className={itemClass}
            >
              <Plus size={12} className="shrink-0 text-emerald-400" /> Nouvelle timeline
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              disabled={sequences.length <= 1}
              title={sequences.length <= 1 ? 'Le projet doit garder une timeline' : undefined}
              className={`${itemClass} hover:text-red-300`}
            >
              <Trash2 size={12} className="shrink-0 text-red-400" /> Supprimer cette timeline
            </button>
          </div>

          {sequences.length > 1 && (
            <div className="border-t border-gray-800 pt-1">
              <div className="px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                Insérer une timeline ici
              </div>
              <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-0.5">
                {sequences.filter(s => s.id !== activeSequenceId).map(seq => {
                  const cycle = wouldCreateCycle(sequences, activeSequenceId, seq.id);
                  return (
                    <button
                      key={seq.id}
                      type="button"
                      role="menuitem"
                      onClick={() => handleInsert(seq.id)}
                      disabled={cycle}
                      title={cycle ? 'Cette timeline contient déjà la timeline courante' : 'Insérer à la tête de lecture'}
                      className={itemClass}
                    >
                      <CornerDownRight size={12} className="shrink-0 text-indigo-400" />
                      <span className="flex-1 min-w-0 truncate">{seq.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
