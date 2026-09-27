"use client";

import { useSyncExternalStore } from 'react';

// Même seuil que le préfixe `md:` de Tailwind : en dessous, mise en page téléphone
const QUERY = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** true sur un écran de téléphone (iPhone en portrait, etc.). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
