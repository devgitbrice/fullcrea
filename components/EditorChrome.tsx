"use client";

import { usePathname } from 'next/navigation';
import { Music, Scissors } from 'lucide-react';
import ExternalLinkButton from '@/components/ExternalLinkButton';
import LastUpdateBadge from '@/components/LastUpdateBadge';
import UpdateNotifier from '@/components/UpdateNotifier';

// Pages publiques de partage : le spectateur ne voit que le lecteur, pas les
// raccourcis ni le badge de version de l'éditeur.
const PUBLIC_PREFIXES = ['/v/', '/embed/'];

// Raccourcis + badge de version, réutilisés en ligne par l'accueil des projets
export function ChromeLinks() {
  return (
    <>
      <ExternalLinkButton href="https://audio.gennn.live" label="Audio" icon={<Music size={16} />} />
      <ExternalLinkButton href="https://cut.gennn.live" label="Cut" icon={<Scissors size={16} />} />
      <LastUpdateBadge />
    </>
  );
}

export default function EditorChrome() {
  const pathname = usePathname() ?? '';
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;
  // L'accueil des projets intègre ces liens dans son propre en-tête (sinon la
  // barre fixe recouvrirait le menu du compte)
  const inlineChrome = pathname === '/';

  return (
    <>
      {!inlineChrome && (
        <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
          <ChromeLinks />
        </div>
      )}
      <UpdateNotifier />
    </>
  );
}
