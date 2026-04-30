"use client";

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, FolderPlus, Check, Folder } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';

export default function ProjectSelector() {
  const { projects, currentProject, selectProject, createProject } = useProject();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fermer le menu si on clique ailleurs
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setDraftName('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Focus auto sur le champ de création
  useEffect(() => {
    if (creating) {
      inputRef.current?.focus();
    }
  }, [creating]);

  const handleSelect = (id: string) => {
    if (id !== currentProject.id) {
      selectProject(id);
    }
    setOpen(false);
  };

  const handleCreate = () => {
    createProject(draftName);
    setDraftName('');
    setCreating(false);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded-md px-3 py-2 text-left transition group"
        title="Changer ou créer un projet"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Folder size={14} className="text-blue-400 shrink-0" />
          <span className="text-sm font-semibold text-white truncate">
            {currentProject.name}
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded-md shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-b border-gray-800">
            Projets
          </div>
          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => handleSelect(p.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm transition ${
                  p.id === currentProject.id
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <span className="truncate">{p.name}</span>
                {p.id === currentProject.id && (
                  <Check size={14} className="shrink-0 text-blue-400" />
                )}
              </button>
            ))}
          </div>

          <div className="border-t border-gray-800">
            {creating ? (
              <div className="p-2 flex gap-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') {
                      setCreating(false);
                      setDraftName('');
                    }
                  }}
                  placeholder="Nom du projet"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleCreate}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-400 hover:bg-blue-600/10 transition"
              >
                <FolderPlus size={14} />
                <span>Créer un projet</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
