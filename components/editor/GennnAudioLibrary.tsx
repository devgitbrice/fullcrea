"use client";

import { useCallback, useEffect, useState } from 'react';
import { AudioLines, ExternalLink, RefreshCw } from 'lucide-react';
import DraggableAsset from './DraggableAsset';
import { getSupabase } from '@/lib/supabase/client';
import { GENNN_AUDIO_URL, gennnAudioProjectUrl, listGennnAudioSets, type GennnAudioSet } from '@/lib/gennnAudio/api';
import { formatRelativeDate } from '@/lib/share';

const REFRESH_MS = 30_000;

/**
 * Section « Gennn Audio » de la bibliothèque : les titres de l'application
 * audio, à glisser sur une piste audio (ou + pour la tête de lecture).
 */
export default function GennnAudioLibrary() {
  const [sets, setSets] = useState<GennnAudioSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      setSets(await listGennnAudioSets(supabase));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lecture impossible');
    }
  }, []);

  useEffect(() => {
    const run = () => { if (document.visibilityState === 'visible') void refresh(); };
    run();
    const timer = setInterval(run, REFRESH_MS);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
    };
  }, [refresh]);

  if (!getSupabase()) return null;

  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 uppercase px-2 mb-2 pt-2 border-t border-gray-800/50">
        <AudioLines size={12} /> Gennn Audio
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto p-0.5 rounded text-gray-500 hover:text-white transition"
          title="Actualiser la liste"
          aria-label="Actualiser la liste des titres Gennn Audio"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {error && <p className="text-[11px] text-red-400 px-2 leading-snug">{error}</p>}

      <div className="space-y-1">
        {sets?.map(set => (
          <DraggableAsset
            key={set.id}
            name={set.name}
            type="audio"
            src=""
            gennnAudio={{ setId: set.id, name: set.name, renderedAt: null }}
            icon={<AudioLines size={18} className="text-emerald-400 shrink-0" />}
            subtitle={`modifié ${formatRelativeDate(set.updatedAt)}`}
            trailing={(
              <a
                href={gennnAudioProjectUrl(set.id)}
                target="_blank"
                rel="noopener noreferrer"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                draggable={false}
                className="shrink-0 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 transition"
                title="Ouvrir dans Gennn Audio (nouvelle fenêtre)"
                aria-label={`Ouvrir ${set.name} dans Gennn Audio`}
              >
                <ExternalLink size={12} />
              </a>
            )}
          />
        ))}
        {sets && sets.length === 0 && (
          <p className="text-[11px] text-gray-500 px-2 leading-snug">
            Aucun titre. <a href={GENNN_AUDIO_URL} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Créer dans Gennn Audio</a>
          </p>
        )}
      </div>
      <p className="text-[10px] text-gray-600 leading-snug px-2 mt-2">
        Glissez un titre sur la timeline : il se met à jour à chaque sauvegarde dans Gennn Audio.
      </p>
    </div>
  );
}
