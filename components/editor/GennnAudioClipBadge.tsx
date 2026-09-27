"use client";

import { AlertTriangle, AudioLines, ExternalLink, Loader2 } from 'lucide-react';
import { gennnAudioProjectUrl } from '@/lib/gennnAudio/api';
import { useGennnAudioStatus } from '@/lib/gennnAudio/status';
import type { GennnAudioLink } from '@/lib/timeline/types';

/** Icône d'un clip Gennn Audio : état du rendu (calcul en cours, erreur). */
export function GennnAudioClipIcon({ link }: { link: GennnAudioLink }) {
  const status = useGennnAudioStatus(link.setId);
  if (status?.state === 'rendering' || !link.renderedAt && status?.state !== 'error') {
    return <Loader2 size={12} className="mr-2 shrink-0 animate-spin text-emerald-200" aria-label="Mise à jour du son Gennn Audio…" />;
  }
  if (status?.state === 'error') {
    return (
      <span className="mr-2 shrink-0 text-amber-300" title={status.message} aria-label={`Gennn Audio : ${status.message}`}>
        <AlertTriangle size={12} />
      </span>
    );
  }
  return <AudioLines size={12} className="mr-2 shrink-0 text-emerald-200" aria-label="Titre Gennn Audio" />;
}

/** Bouton ↗ : ouvre le projet dans Gennn Audio, dans une nouvelle fenêtre. */
export function GennnAudioOpenButton({ link }: { link: GennnAudioLink }) {
  return (
    <a
      href={gennnAudioProjectUrl(link.setId)}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      draggable={false}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0.5 right-6 w-5 h-5 rounded-full bg-emerald-600/90 hover:bg-emerald-500 text-white flex items-center justify-center z-30 shadow-md"
      style={{ touchAction: 'manipulation' }}
      title={`Ouvrir « ${link.name} » dans Gennn Audio (nouvelle fenêtre)`}
      aria-label={`Ouvrir ${link.name} dans Gennn Audio`}
    >
      <ExternalLink size={10} strokeWidth={3} />
    </a>
  );
}
