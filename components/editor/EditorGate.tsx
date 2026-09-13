"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Loader2, FolderX, ArrowLeft } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';

// Attend l'hydratation et affiche un message si le projet demandé par l'URL
// n'est pas accessible.
export default function EditorGate({ shareToken, children }: { shareToken?: string; children: ReactNode }) {
  const { isHydrated, projectNotFound } = useProject();

  if (!isHydrated) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 bg-black text-gray-400">
        <Loader2 className="animate-spin" size={24} />
        <span className="text-xs">Chargement du projet…</span>
      </div>
    );
  }

  if (projectNotFound) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-gray-300 p-6">
        <div className="max-w-md text-center space-y-4">
          <FolderX className="mx-auto text-amber-400" size={32} />
          <h1 className="text-xl font-semibold text-white">Projet introuvable</h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            Ce projet n&apos;existe pas, a été supprimé, ou vous n&apos;y avez pas accès.
            {shareToken ? ' Le lien de co-édition est peut-être invalide.' : ''}
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-medium transition"
          >
            <ArrowLeft size={14} /> Retour à mes projets
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
