"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Radio, RefreshCw, X } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { fetchSharePayload, type SharePayload } from '@/lib/supabase/sharesRepo';
import { playUpdateChime } from '@/lib/share/notifySound';
import LivePlayer from './LivePlayer';

// Un partage en direct est relu régulièrement : l'éditeur sauvegarde ~0,6 s
// après une modification, elle apparaît donc ici en quelques secondes.
const POLL_MS = 4000;

type State =
  | { status: 'loading' }
  | { status: 'ready'; payload: SharePayload }
  | { status: 'missing' }
  | { status: 'error'; message: string };

export interface ShareUpdates {
  /** Nombre de sauvegardes du projet depuis l'ouverture de la page */
  count: number;
  /** Recharge la page pour voir la dernière version */
  refresh: () => void;
  /** Masque la pastille (elle réapparaît à la prochaine modification) */
  dismiss: () => void;
}

/**
 * Charge un partage (lecture publique, sans compte). Un partage en direct est
 * surveillé en continu : les modifications du projet ne remplacent PAS la
 * lecture en cours, elles sont signalées et appliquées au rafraîchissement.
 */
export function useShare(id: string): { state: State; updates: ShareUpdates } {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [count, setCount] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(0);
  const shownRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setState({ status: 'error', message: "Partage indisponible : Supabase n'est pas configuré sur ce déploiement." });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async (first: boolean) => {
      try {
        const payload = await fetchSharePayload(supabase, id);
        if (cancelled) return;
        if (!payload) {
          setState({ status: 'missing' });
          return;
        }
        const stamp = payload.montage?.updatedAt ?? null;
        if (first) {
          shownRef.current = stamp;
          setState({ status: 'ready', payload });
        } else if (stamp !== shownRef.current) {
          // Le projet a été sauvegardé : on prévient sans interrompre la lecture
          shownRef.current = stamp;
          setCount(n => n + 1);
          void playUpdateChime();
        }
        if (payload.share.live) schedule();
      } catch (e) {
        if (cancelled) return;
        if (first) setState({ status: 'error', message: e instanceof Error ? e.message : 'Erreur inconnue' });
        else schedule(); // une lecture ratée ne casse pas la lecture en cours
      }
    };

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        // Onglet caché : on attend son retour plutôt que d'interroger pour rien
        if (document.visibilityState === 'hidden') schedule();
        else void load(false);
      }, POLL_MS);
    };

    void load(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  const refresh = useCallback(() => window.location.reload(), []);
  const dismiss = useCallback(() => setDismissedAt(count), [count]);

  return { state, updates: { count: count > dismissedAt ? count : 0, refresh, dismiss } };
}

/**
 * Pastille « le projet a changé » : proposée au spectateur d'un lien en direct
 * plutôt que de recharger le montage sous ses yeux pendant la lecture.
 */
export function UpdateBanner({ updates, compact = false }: { updates: ShareUpdates; compact?: boolean }) {
  if (updates.count === 0) return null;
  const label = updates.count > 1
    ? `${updates.count} mises à jour du projet`
    : 'Le projet a été modifié';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed z-50 flex items-center gap-2 rounded-lg border border-orange-700 bg-gray-950/95 shadow-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 ${
        compact ? 'top-2 left-2 right-2 px-2 py-1.5' : 'bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm px-3 py-2.5'
      }`}
    >
      <RefreshCw size={compact ? 12 : 15} className="shrink-0 text-orange-400" />
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-gray-100 truncate ${compact ? 'text-[11px]' : 'text-xs'}`}>{label}</p>
        {!compact && (
          <p className="text-[10px] text-gray-400 leading-snug">
            Rafraîchis la page pour voir la dernière version.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={updates.refresh}
        className={`shrink-0 rounded bg-orange-600 hover:bg-orange-500 font-semibold text-white transition ${
          compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'
        }`}
      >
        Rafraîchir
      </button>
      <button
        type="button"
        onClick={updates.dismiss}
        aria-label="Masquer"
        className="shrink-0 p-1 rounded text-gray-500 hover:text-white transition"
      >
        <X size={compact ? 11 : 13} />
      </button>
    </div>
  );
}

interface SharePlayerProps {
  payload: SharePayload;
  /** Mode intégration : lecteur seul, sans marges ni titre */
  bare?: boolean;
}

/** Lecteur d'un partage : montage en direct, ou MP4 rendu pour un lien figé. */
export function SharePlayer({ payload, bare = false }: SharePlayerProps) {
  const { share, montage } = payload;

  if (share.live && montage) {
    return (
      <LivePlayer
        sequences={montage.sequences}
        sequenceId={montage.sequenceId}
        settings={montage.settings}
        bare={bare}
      />
    );
  }

  if (!share.src) {
    return (
      <div className="text-center text-sm text-gray-400 p-4">
        Ce partage ne contient pas encore de vidéo.
      </div>
    );
  }

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

/** Pastille « direct » : le lien suit les modifications du projet. */
export function LiveBadge() {
  return (
    <span
      title="Ce lien suit le projet : les modifications apparaissent automatiquement"
      className="inline-flex items-center gap-1 rounded-full bg-red-950/60 border border-red-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300"
    >
      <Radio size={10} className="animate-pulse" />
      Direct
    </span>
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
