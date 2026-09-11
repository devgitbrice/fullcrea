"use client";

import type { ReactNode } from 'react';
import { useProject } from '@/components/ProjectContext';
import { Loader2, Check, AlertTriangle, Cloud, HardDrive } from 'lucide-react';

const STORAGE_LABELS = {
  cloud: 'Sauvegarde cloud (Supabase)',
  local: 'Sauvegarde locale (navigateur)',
  'local-fallback': 'Sauvegarde locale (Supabase indisponible)',
} as const;

function formatTime(date: Date) {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function SaveIndicator() {
  const { saveStatus, lastSavedAt, persistenceMode, persistenceError } = useProject();

  if (saveStatus === 'idle') return null;

  const StorageIcon = persistenceMode === 'cloud' ? Cloud : HardDrive;
  const storageLabel = STORAGE_LABELS[persistenceMode];

  let content: ReactNode;
  let tone = 'text-gray-400';
  let title: string = storageLabel;

  switch (saveStatus) {
    case 'saving':
      content = <><Loader2 size={12} className="animate-spin" /> Enregistrement…</>;
      break;
    case 'saved':
      content = (
        <>
          <Check size={12} className="text-emerald-400" />
          {lastSavedAt ? `Enregistré à ${formatTime(lastSavedAt)}` : 'Enregistré'}
        </>
      );
      break;
    case 'dirty':
      tone = 'text-amber-400';
      content = <><span aria-hidden className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Modifications non enregistrées</>;
      break;
    case 'error':
      tone = 'text-red-400';
      title = persistenceError ?? storageLabel;
      content = <><AlertTriangle size={12} /> Erreur de sauvegarde</>;
      break;
  }

  return (
    <div
      title={title}
      className={`flex items-center gap-1.5 bg-gray-900 border border-gray-800 rounded-full pl-2 pr-2.5 py-0.5 text-[11px] whitespace-nowrap transition-colors ${tone}`}
    >
      <StorageIcon size={12} className="text-gray-500 shrink-0" />
      <span className="w-px h-3 bg-gray-800" aria-hidden />
      <span className="flex items-center gap-1.5">{content}</span>
      {saveStatus === 'error' && <span role="alert" className="sr-only">{title}</span>}
    </div>
  );
}
