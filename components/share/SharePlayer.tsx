"use client";

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { fetchShare, type Share } from '@/lib/supabase/sharesRepo';

type State =
  | { status: 'loading' }
  | { status: 'ready'; share: Share }
  | { status: 'missing' }
  | { status: 'error'; message: string };

/** Charge un partage par son id (lecture publique, sans compte). */
export function useShare(id: string): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setState({ status: 'error', message: 'Partage indisponible : Supabase n\'est pas configuré sur ce déploiement.' });
      return;
    }
    let cancelled = false;
    fetchShare(supabase, id)
      .then((share) => {
        if (cancelled) return;
        setState(share ? { status: 'ready', share } : { status: 'missing' });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({ status: 'error', message: e instanceof Error ? e.message : 'Erreur inconnue' });
      });
    return () => { cancelled = true; };
  }, [id]);

  return state;
}

interface SharePlayerProps {
  share: Share;
  /** Mode intégration : lecteur seul, sans marges ni titre */
  bare?: boolean;
}

export function SharePlayer({ share, bare = false }: SharePlayerProps) {
  return (
    <video
      src={share.src}
      controls
      playsInline
      preload="metadata"
      className={bare ? 'w-full h-full bg-black' : 'w-full h-auto max-h-full bg-black rounded-lg shadow-2xl'}
      style={{ aspectRatio: `${share.width} / ${share.height}` }}
    >
      Votre navigateur ne peut pas lire cette vidéo.
    </video>
  );
}

export function ShareStatus({ state }: { state: State }) {
  if (state.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <Loader2 size={16} className="animate-spin" /> Chargement de la vidéo…
      </div>
    );
  }
  if (state.status === 'missing') {
    return (
      <div className="text-center space-y-2 max-w-sm">
        <AlertCircle size={28} className="mx-auto text-amber-400" />
        <h1 className="text-base font-semibold text-white">Vidéo introuvable</h1>
        <p className="text-sm text-gray-400">Ce lien de partage n&apos;existe plus ou n&apos;a jamais existé.</p>
      </div>
    );
  }
  return (
    <div className="text-center space-y-2 max-w-sm">
      <AlertCircle size={28} className="mx-auto text-red-400" />
      <h1 className="text-base font-semibold text-white">Lecture impossible</h1>
      <p className="text-sm text-gray-400 break-words">{state.status === 'error' ? state.message : ''}</p>
    </div>
  );
}
