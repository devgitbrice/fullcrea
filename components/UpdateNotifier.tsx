"use client";

import { useEffect, useRef, useState } from "react";

const CHECK_INTERVAL_MS = 60_000;

function playPlocSound() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(220, now + 0.15);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.2);
    oscillator.onended = () => ctx.close();
  } catch {
    // L'audio n'est pas critique : on ignore silencieusement les erreurs
    // (autoplay bloqué, API indisponible, etc.)
  }
}

export default function UpdateNotifier() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const currentVersionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkVersion() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = await res.json();
        if (cancelled) return;

        if (currentVersionRef.current === null) {
          currentVersionRef.current = version;
          return;
        }

        if (version !== currentVersionRef.current && !updateAvailable) {
          setUpdateAvailable(true);
          playPlocSound();
        }
      } catch {
        // Requête réseau échouée : on retentera au prochain intervalle
      }
    }

    checkVersion();
    const intervalId = setInterval(checkVersion, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [updateAvailable]);

  if (!updateAvailable) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[200] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border border-gray-800 bg-gray-950 p-4 shadow-2xl">
      <p className="mb-3 text-sm text-gray-200">
        Une nouvelle version de l&apos;application est disponible.
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setUpdateAvailable(false)}
          className="rounded px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
        >
          Plus tard
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Rafraîchir
        </button>
      </div>
    </div>
  );
}
