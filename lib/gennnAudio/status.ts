"use client";

// État du rendu de chaque titre Gennn Audio (affiché sur les clips).

import { useSyncExternalStore } from 'react';

export type GennnAudioStatus =
  | { state: 'rendering' }
  | { state: 'ready' }
  | { state: 'error'; message: string };

const statuses = new Map<string, GennnAudioStatus>();
const listeners = new Set<() => void>();

export function setGennnAudioStatus(setId: string, status: GennnAudioStatus) {
  statuses.set(setId, status);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useGennnAudioStatus(setId: string | undefined): GennnAudioStatus | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (setId ? statuses.get(setId) : undefined),
    () => undefined,
  );
}
