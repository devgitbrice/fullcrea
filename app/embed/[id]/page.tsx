"use client";

import { use } from 'react';
import { SharePlayer, ShareStatus, useShare } from '@/components/share/SharePlayer';

/** Lecteur nu pour l'intégration en iframe : /embed/<id> */
export default function EmbedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const state = useShare(id);

  return (
    <main className="h-screen w-screen bg-black text-white flex items-center justify-center overflow-hidden">
      {state.status === 'ready'
        ? <SharePlayer share={state.share} bare />
        : <div className="p-4"><ShareStatus state={state} /></div>}
    </main>
  );
}
