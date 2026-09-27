"use client";

import { useEffect, useMemo, useRef } from 'react';
import { useProject } from '@/components/ProjectContext';
import { getSupabase, STORAGE_BUCKET } from '@/lib/supabase/client';
import { fetchGennnAudioStamps, loadGennnAudioForRender } from '@/lib/gennnAudio/api';
import { renderGennnAudio } from '@/lib/gennnAudio/renderer';
import { setGennnAudioStatus } from '@/lib/gennnAudio/status';
import { neighborBounds } from '@/lib/timeline/clipOps';
import { MIN_CLIP_WIDTH_PX, PX_PER_SEC_BASE, type Clip } from '@/lib/timeline/types';

// Fréquence de surveillance des projets Gennn Audio liés (onglet visible)
const POLL_MS = 3000;
// Rendus en cours, par projet : jamais deux rendus simultanés du même titre
const busy = new Set<string>();

/** Chemin Storage d'un fichier du bucket public, d'après son URL publique. */
function storagePathOf(url: string): string | null {
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}

/**
 * Titres Gennn Audio de la timeline : surveille leurs projets et, dès qu'un
 * projet est sauvegardé dans Gennn Audio, recalcule le mix et remplace le son
 * des clips liés (sans recharger la page). Le WAV est déposé dans le Storage
 * du projet : lecteur de partage, Muxeo et export l'entendent aussi.
 */
export function useGennnAudioSync() {
  const { clips, setClipsWithoutHistory, userId, currentProjectId, readOnly } = useProject();
  const clipsRef = useRef(clips);
  useEffect(() => { clipsRef.current = clips; }, [clips]);

  const setIdsKey = useMemo(
    () => [...new Set(clips.flatMap(c => (c.gennnAudio ? [c.gennnAudio.setId] : [])))].sort().join(','),
    [clips],
  );

  useEffect(() => {
    if (readOnly || !setIdsKey) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    const ids = setIdsKey.split(',');

    const renderOne = async (setId: string) => {
      busy.add(setId);
      setGennnAudioStatus(setId, { state: 'rendering' });
      try {
        const { set, name, updatedAt, samples } = await loadGennnAudioForRender(supabase, setId);
        const { wav, duration } = await renderGennnAudio(set, samples);
        let src: string;
        if (userId) {
          const path = `${userId}/${currentProjectId}/gennn-audio/${setId}-${Date.now()}.wav`;
          const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(path, new Blob([wav], { type: 'audio/wav' }), { contentType: 'audio/wav', upsert: false, cacheControl: '31536000' });
          if (error) throw new Error(`Envoi du son échoué : ${error.message}`);
          src = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
        } else {
          src = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
        }
        if (cancelled) return;

        const replaced = new Set<string>();
        const naturalPx = duration * PX_PER_SEC_BASE;
        setClipsWithoutHistory(prev => prev.map((c): Clip => {
          const link = c.gennnAudio;
          if (link?.setId !== setId) return c;
          if (c.src && c.src !== src) replaced.add(c.src);
          const offset = c.offset ?? 0;
          // Clip qui suivait la longueur du titre (jamais rendu, ou non rogné) :
          // il suit la nouvelle longueur, sans empiéter sur le clip suivant
          const follows = !link.renderedAt || c.sourceDuration == null || Math.abs(c.width + offset - c.sourceDuration) < 1;
          const room = neighborBounds(prev, c).nextStart - c.start;
          const width = follows
            ? Math.min(naturalPx - offset, room)
            : Math.min(c.width, naturalPx - offset);
          return {
            ...c,
            src,
            sourceDuration: naturalPx,
            width: Math.max(MIN_CLIP_WIDTH_PX, width),
            name: c.name === link.name ? name : c.name,
            gennnAudio: { ...link, name, renderedAt: updatedAt },
          };
        }));
        setGennnAudioStatus(setId, { state: 'ready' });

        // Anciennes versions du son : retirées du Storage (au mieux)
        const oldPaths = [...replaced].map(storagePathOf).filter((p): p is string => !!p && p.includes('/gennn-audio/'));
        if (oldPaths.length > 0) void supabase.storage.from(STORAGE_BUCKET).remove(oldPaths);
      } catch (e) {
        setGennnAudioStatus(setId, { state: 'error', message: e instanceof Error ? e.message : 'Rendu impossible' });
      } finally {
        busy.delete(setId);
      }
    };

    const tick = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      let stamps;
      try {
        stamps = await fetchGennnAudioStamps(supabase, ids);
      } catch {
        return; // réseau : prochain passage
      }
      if (cancelled) return;
      for (const id of ids) {
        if (busy.has(id)) continue;
        const stamp = stamps.get(id);
        if (!stamp) {
          setGennnAudioStatus(id, { state: 'error', message: 'Projet Gennn Audio introuvable (supprimé, ou appartenant à un autre compte)' });
          continue;
        }
        const linked = clipsRef.current.filter(c => c.gennnAudio?.setId === id);
        if (linked.some(c => c.gennnAudio?.renderedAt !== stamp.updatedAt || !c.src)) void renderOne(id);
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [setIdsKey, readOnly, setClipsWithoutHistory, userId, currentProjectId]);
}
