"use client";

import { usePathname } from 'next/navigation';
import { Music, Scissors } from 'lucide-react';
import ExternalLinkButton from '@/components/ExternalLinkButton';
import LastUpdateBadge from '@/components/LastUpdateBadge';
import UpdateNotifier from '@/components/UpdateNotifier';

// Pages publiques de partage : le spectateur ne voit que le lecteur, pas les
// raccourcis ni le badge de version de l'éditeur.
const PUBLIC_PREFIXES = ['/v/', '/embed/'];

export default function EditorChrome() {
  const pathname = usePathname() ?? '';
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  return (
    <>
      <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
        <ExternalLinkButton href="https://audio.gennn.live" label="Audio" icon={<Music size={16} />} />
        <ExternalLinkButton href="https://cut.gennn.live" label="Cut" icon={<Scissors size={16} />} />
        <LastUpdateBadge />
      </div>
      <UpdateNotifier />
    </>
  );
}
