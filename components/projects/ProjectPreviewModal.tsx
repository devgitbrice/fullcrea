"use client";

import { useId } from 'react';
import { X, Eye } from 'lucide-react';
import Player from '@/components/editor/Player';
import { ProjectProvider, type Project } from '@/components/ProjectContext';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';

export default function ProjectPreviewModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const titleId = useId();
  useEscapeKey(onClose);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-5xl h-[80vh] bg-gray-950 border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Eye size={16} className="text-blue-400 shrink-0" />
            <h2 id={titleId} className="text-sm font-semibold text-white truncate">{project.name}</h2>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider shrink-0">Prévisualisation</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[10px] text-gray-600 hidden sm:inline">Échap pour fermer</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer la prévisualisation"
              title="Fermer"
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800 transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {/* Provider isolé et en lecture seule : aucune sauvegarde depuis l'aperçu */}
          <ProjectProvider preloadedProject={project} readOnly>
            <Player />
          </ProjectProvider>
        </div>
      </div>
    </div>
  );
}
