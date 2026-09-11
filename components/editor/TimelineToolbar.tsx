"use client";

import { shouldIgnoreShortcut } from '@/lib/keyboard';
import { useEffect } from 'react';
import { Copy, MousePointer2, Redo2, Scissors, Trash2, Type, Undo2, type LucideIcon } from 'lucide-react';
import { useProject, type ToolMode } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import ZoomControls from './ZoomControls';

interface ToolDefinition {
  id: ToolMode;
  label: string;
  shortcut: string;
  icon: LucideIcon;
  activeClass: string;
  textClass: string;
}

const TOOLS: ToolDefinition[] = [
  {
    id: 'select',
    label: 'Sélection',
    shortcut: 'V',
    icon: MousePointer2,
    activeClass: 'bg-blue-600 text-white shadow-lg shadow-blue-900/20',
    textClass: 'text-blue-500',
  },
  {
    id: 'cut',
    label: 'Cutter',
    shortcut: 'C',
    icon: Scissors,
    activeClass: 'bg-red-600 text-white shadow-lg shadow-red-900/20',
    textClass: 'text-red-500',
  },
  {
    id: 'text',
    label: 'Texte',
    shortcut: 'T',
    icon: Type,
    activeClass: 'bg-yellow-600 text-white shadow-lg shadow-yellow-900/20',
    textClass: 'text-yellow-500',
  },
];

const SHORTCUT_TO_TOOL: Partial<Record<string, ToolMode>> = { v: 'select', c: 'cut', t: 'text' };

const actionButtonClass =
  'p-1.5 rounded transition-all duration-200 text-gray-400 hover:bg-gray-800 hover:text-gray-200 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400';

function Separator({ className = '' }: { className?: string }) {
  return <div className={`w-px h-4 bg-gray-800 mx-2 ${className}`} aria-hidden="true" />;
}

interface TimelineToolbarProps {
  // Fourni par la Timeline (removeClip) pour partager son toast « Clip supprimé »
  // et sa restauration ciblée ; sans lui, on retombe sur deleteClip + undo.
  onDeleteClip?: (id: string) => void;
}

export default function TimelineToolbar({ onDeleteClip }: TimelineToolbarProps) {
  const {
    activeTool,
    setActiveTool,
    undo,
    redo,
    canUndo,
    canRedo,
    selectedClipId,
    deleteClip,
    duplicateClip,
  } = useProject();
  const { toast } = useToast();

  const handleDeleteClip = (id: string) => {
    if (onDeleteClip) {
      onDeleteClip(id);
      return;
    }
    deleteClip(id);
    toast({ message: 'Clip supprimé', type: 'info', action: { label: 'Annuler', onClick: undo } });
  };

  // Raccourcis outils : ignorés avec un modificateur (Ctrl+C = copier, pas le
  // cutter), pendant la saisie de texte et sur les répétitions de touche.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (shouldIgnoreShortcut(e)) return;
      const tool = SHORTCUT_TO_TOOL[e.key.toLowerCase()];
      if (tool) setActiveTool(tool);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool]);

  const currentTool = TOOLS.find(t => t.id === activeTool) ?? TOOLS[0];

  return (
    <div className="h-10 flex items-center px-4 gap-2 border-b border-gray-800 bg-gray-950 select-none shrink-0">
      {/* Historique */}
      <button
        onClick={undo}
        disabled={!canUndo}
        className={actionButtonClass}
        title="Annuler (Ctrl+Z)"
        aria-label="Annuler (Ctrl+Z)"
      >
        <Undo2 size={18} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        className={actionButtonClass}
        title="Rétablir (Ctrl+Maj+Z)"
        aria-label="Rétablir (Ctrl+Maj+Z)"
      >
        <Redo2 size={18} />
      </button>

      <Separator />

      {/* Outils */}
      {TOOLS.map(({ id, label, shortcut, icon: Icon, activeClass }) => {
        const isActive = activeTool === id;
        return (
          <button
            key={id}
            onClick={() => setActiveTool(id)}
            className={`p-1.5 rounded transition-all duration-200 ${
              isActive ? activeClass : 'hover:bg-gray-800 text-gray-400'
            }`}
            title={`Outil ${label} (${shortcut})`}
            aria-label={`Outil ${label} (${shortcut})`}
            aria-pressed={isActive}
          >
            <Icon size={18} />
          </button>
        );
      })}

      <Separator className="hidden sm:block" />

      {/* Label d'état */}
      <span className="text-[10px] text-gray-500 uppercase font-bold tracking-widest hidden sm:inline">
        Outil actuel : <span className={currentTool.textClass}>{currentTool.label}</span>
      </span>

      {/* Actions sur le clip sélectionné (raccourcis gérés par la Timeline) */}
      {selectedClipId && (
        <>
          <Separator />
          <button
            onClick={() => duplicateClip(selectedClipId)}
            className={actionButtonClass}
            title="Dupliquer (Ctrl+D)"
            aria-label="Dupliquer le clip (Ctrl+D)"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={() => handleDeleteClip(selectedClipId)}
            className={`${actionButtonClass} hover:text-red-400`}
            title="Supprimer (Suppr)"
            aria-label="Supprimer le clip (Suppr)"
          >
            <Trash2 size={16} />
          </button>
        </>
      )}

      <div className="ml-auto shrink-0">
        <ZoomControls />
      </div>
    </div>
  );
}
