"use client";

import { use } from 'react';
import { SharePlayer, ShareStatus, useShare } from '@/components/share/SharePlayer';

/** Page publique de lecture d'un partage : /v/<id> */
export default function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const state = useShare(id);

  return (
    <main className="h-screen w-screen bg-black text-white flex flex-col items-center justify-center gap-4 p-4 sm:p-8 overflow-auto">
      {state.status === 'ready' ? (
        <>
          <div className="w-full max-w-5xl flex-1 min-h-0 flex items-center justify-center">
            <SharePlayer share={state.share} />
          </div>
          <div className="w-full max-w-5xl flex flex-wrap items-center justify-between gap-2 shrink-0">
            <h1 className="text-sm font-semibold text-gray-100 truncate">{state.share.title}</h1>
            <a
              href={state.share.src}
              download
              className="text-[11px] text-gray-400 hover:text-white underline underline-offset-2 transition"
            >
              Télécharger la vidéo
            </a>
          </div>
        </>
      ) : (
        <ShareStatus state={state} />
      )}
      <footer className="shrink-0 text-[10px] text-gray-600">Réalisé avec Gennn Cut</footer>
    </main>
  );
}
