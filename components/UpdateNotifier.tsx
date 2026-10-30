"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const CHECK_INTERVAL_MS = 60_000;

// Commit de CETTE page (gravé au build, voir next.config.ts). /api/version renvoie
// celui du déploiement en ligne : s'ils diffèrent, la page est périmée, même si
// elle a été ouverte avant le déploiement. En local (pas de commit) : on compare
// à la première réponse du serveur.
const PAGE_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT || null;

// Contexte audio partagé, « déverrouillé » au premier clic ou à la première
// touche : sans ça, le navigateur bloque le bip joué plus tard sans action.
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

// Bip en deux notes (aigu puis plus aigu)
async function playBeep() {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") await ctx.resume();
    const now = ctx.currentTime;
    [
      { freq: 880, start: 0 },
      { freq: 1320, start: 0.18 },
    ].forEach(({ freq, start }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.17);
    });
  } catch {
    // L'audio n'est pas critique : le pop-up s'affiche quand même
  }
}

export default function UpdateNotifier() {
  // Version en ligne qui a déclenché le pop-up (null = rien à signaler)
  const [newVersion, setNewVersion] = useState<string | null>(null);
  // Référence : la version de la page (ou, à défaut, la première réponse du serveur)
  const baseVersionRef = useRef<string | null>(null);
  // Version écartée par « Plus tard » : on ne la re-signale pas
  const dismissedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let checking = false;

    async function checkVersion() {
      if (checking || !navigator.onLine) return;
      checking = true;
      try {
        const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const { version } = await res.json();
        if (cancelled) return;

        let isNew: boolean;
        if (PAGE_COMMIT) {
          isNew = version !== PAGE_COMMIT;
        } else {
          if (baseVersionRef.current === null) baseVersionRef.current = version;
          isNew = version !== baseVersionRef.current;
        }
        if (isNew && dismissedRef.current !== version) {
          setNewVersion((prev) => {
            if (prev !== version) playBeep();
            return version;
          });
        }
      } catch {
        // Requête réseau échouée : on retentera plus tard
      } finally {
        checking = false;
      }
    }

    // Retour sur l'onglet / la fenêtre / le réseau : vérification immédiate
    // (les minuteries des onglets en arrière-plan sont ralenties par le navigateur)
    const onVisible = () => {
      if (document.visibilityState === "visible") checkVersion();
    };

    checkVersion();
    const intervalId = setInterval(checkVersion, CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkVersion);
    window.addEventListener("online", checkVersion);
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkVersion);
      window.removeEventListener("online", checkVersion);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  if (!newVersion) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-labelledby="update-title"
        className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-950 p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600/20 text-blue-400">
            <RefreshCw size={18} />
          </div>
          <h2 id="update-title" className="text-base font-semibold text-white">
            Nouvelle version disponible
          </h2>
        </div>
        <p className="mb-5 text-sm text-gray-300">
          Gennn Cut a été mis à jour. Recharge la page pour utiliser la dernière
          version (ton projet est enregistré automatiquement).
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              dismissedRef.current = newVersion;
              setNewVersion(null);
            }}
            className="rounded-md px-3 py-2 text-sm text-gray-400 hover:text-gray-200"
          >
            Plus tard
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <RefreshCw size={14} /> Recharger la page
          </button>
        </div>
      </div>
    </div>
  );
}
