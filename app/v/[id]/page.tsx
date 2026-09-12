"use client";

import { use } from 'react';
import { LiveBadge, SharePlayer, ShareStatus, UpdateBanner, useShare } from '@/components/share/SharePlayer';

/** Page publique de lecture d'un partage : /v/<id> */
export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, updates } = useShare(id);

  return (
    <main className="min-h-screen w-full bg-black text-white flex flex-col items-center justify-center gap-4 p-4 sm:p-8">
      {state.status === 'ready' ? (
        <>
          <div className="w-full max-w-5xl">
            <SharePlayer payload={state.payload} />
          </div>
          <div className="w-full max-w-5xl flex flex-wrap items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 text-sm font-semibold text-gray-100 min-w-0">
              <span className="truncate">{state.payload.montage?.title ?? state.payload.share.title}</span>
              {state.payload.share.live && <LiveBadge />}
            </h1>
            {state.payload.share.src && (
              <a
                href={state.payload.share.src}
                download
                className="text-[11px] text-gray-400 hover:text-white underline underline-offset-2 transition"
              >
                Télécharger la vidéo
              </a>
            )}
          </div>
        </>
      ) : (
        <ShareStatus state={state} />
      )}
      <footer className="text-[10px] text-gray-600">Réalisé avec Gennn Cut</footer>
      <UpdateBanner updates={updates} />
    </main>
  );
}
