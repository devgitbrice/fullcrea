"use client";

import { shouldIgnoreShortcut } from '@/lib/keyboard';
import { useEffect, useState } from 'react';
import {
  Copy, FoldHorizontal, ListChecks, Magnet, MousePointer2, Network, Redo2, Scissors, SquareSplitHorizontal, Trash2, Type, Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useProject, type ToolMode } from '@/components/ProjectContext';
import ZoomControls from './ZoomControls';
import SequenceSelector from './SequenceSelector';
import MindmapView from './MindmapView';

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

// B = alias du cutter (Ctrl+B coupe à la tête, géré par la Timeline)
const SHORTCUT_TO_TOOL: Partial<Record<string, ToolMode>> = { v: 'select', c: 'cut', b: 'cut', t: 'text' };

const actionButtonClass =
  'p-1.5 rounded transition-all duration-200 text-gray-400 hover:bg-gray-800 hover:text-gray-200 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400';
// Bascules (multi-sélection, aimant) : mises en évidence quand actives
const toggleButtonClass = (active: boolean) =>
  `p-1.5 rounded transition-all duration-200 ${active ? 'bg-cyan-700 text-white shadow-lg shadow-cyan-900/20' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`;

function Separator({ className = '' }: { className?: string }) {
  return <div className={`w-px h-4 bg-gray-800 mx-2 ${className}`} aria-hidden="true" />;
}

interface TimelineToolbarProps {
  // Fournis par la Timeline : suppression / ripple + toast « Annuler »
  // (undoIfTop), coupe à la tête — un seul chemin pour le clavier, le X et la
  // toolbar. Les raccourcis (Suppr, Maj+Suppr, Ctrl+B, N) vivent dans Timeline.
  onDeleteClips: (ids: string[]) => void;
  onRippleDeleteClips: (ids: string[]) => void;
  onSplit: () => void;
  multiSelectMode: boolean;
  onToggleMulti: () => void;
}

export default function TimelineToolbar({
  onDeleteClips, onRippleDeleteClips, onSplit, multiSelectMode, onToggleMulti,
}: TimelineToolbarProps) {
  const {
    activeTool,
    setActiveTool,
    undo,
    redo,
    canUndo,
    canRedo,
    selectedClipIds,
    duplicateClips,
    snapEnabled,
    setSnapEnabled,
  } = useProject();
  const [mindmapOpen, setMindmapOpen] = useState(false);

  // Raccourcis outils : ignorés avec un modificateur (Ctrl+C = copier, pas le
  // cutter ; Maj+lettre reste libre), pendant la saisie de texte et sur les
  // répétitions de touche.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
      if (shouldIgnoreShortcut(e)) return;
      const tool = SHORTCUT_TO_TOOL[e.key.toLowerCase()];
      if (tool) setActiveTool(tool);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool]);

  const currentTool = TOOLS.find(t => t.id === activeTool) ?? TOOLS[0];

  return (
    <div className="h-10 flex items-center px-4 gap-2 border-b border-gray-800 bg-gray-950 select-none shrink-0 overflow-x-auto custom-scrollbar">
      {/* Timeline courante du projet (et timelines imbriquées) */}
      <SequenceSelector />

      {/* Vue d'ensemble du projet : une bulle par timeline */}
      <button
        onClick={() => setMindmapOpen(true)}
        className={`${actionButtonClass} shrink-0`}
        title="Vue mindmap du projet"
        aria-label="Vue mindmap du projet"
        aria-haspopup="dialog"
      >
        <Network size={18} />
      </button>

      <Separator />

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

      <Separator />

      {/* Bascules : multi-sélection (tactile) et aimant */}
      <button
        onClick={onToggleMulti}
        className={toggleButtonClass(multiSelectMode)}
        title="Sélection multiple (tap = ajouter/retirer)"
        aria-label="Sélection multiple"
        aria-pressed={multiSelectMode}
      >
        <ListChecks size={18} />
      </button>
      <button
        onClick={() => setSnapEnabled(!snapEnabled)}
        className={toggleButtonClass(snapEnabled)}
        title="Aimant (N)"
        aria-label="Aimant (N)"
        aria-pressed={snapEnabled}
      >
        <Magnet size={18} />
      </button>

      <Separator />

      {/* Coupe à la tête de lecture */}
      <button
        onClick={onSplit}
        className={actionButtonClass}
        title="Couper à la tête de lecture (Ctrl+B)"
        aria-label="Couper à la tête de lecture (Ctrl+B)"
      >
        <SquareSplitHorizontal size={18} />
      </button>

      {/* Actions sur la sélection (raccourcis gérés par la Timeline) */}
      {selectedClipIds.length > 0 && (
        <>
          <Separator />
          <button
            onClick={() => duplicateClips(selectedClipIds)}
            className={actionButtonClass}
            title="Dupliquer (Ctrl+D)"
            aria-label="Dupliquer la sélection (Ctrl+D)"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={() => onDeleteClips(selectedClipIds)}
            className={`${actionButtonClass} hover:text-red-400`}
            title="Supprimer (Suppr)"
            aria-label="Supprimer la sélection (Suppr)"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={() => onRippleDeleteClips(selectedClipIds)}
            className={`${actionButtonClass} hover:text-red-400`}
            title="Supprimer et refermer (Maj+Suppr)"
            aria-label="Supprimer la sélection et refermer le trou (Maj+Suppr)"
          >
            <FoldHorizontal size={16} />
          </button>
        </>
      )}

      <div className="ml-auto shrink-0">
        <ZoomControls />
      </div>

      {mindmapOpen && <MindmapView onClose={() => setMindmapOpen(false)} />}
    </div>
  );
}
