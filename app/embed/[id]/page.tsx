"use client";

import { use } from 'react';
import { SharePlayer, ShareStatus, UpdateBanner, useShare } from '@/components/share/SharePlayer';

/**
 * Lecteur nu pour l'intégration en iframe : /embed/<id>
 * `?auto=1` : les sauvegardes du projet s'appliquent sans rafraîchir (Muxeo).
 */
export default function EmbedPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const { id } = use(params);
  const { auto } = use(searchParams);
  const { state, updates } = useShare(id, { autoApply: auto === '1' });

  return (
    <main className="h-screen w-screen bg-black text-white flex items-center justify-center overflow-hidden">
      {state.status === 'ready'
        ? <SharePlayer payload={state.payload} bare />
        : <div className="p-4"><ShareStatus state={state} /></div>}
      <UpdateBanner updates={updates} compact />
    </main>
  );
}
