"use client";

import { useEffect, useState } from "react";

function formatRelativeTime(from: Date, to: Date): string {
  const diffSeconds = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

  if (diffSeconds < 60) return "à l'instant";

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `il y a ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `il y a ${diffHours} h`;

  const diffDays = Math.floor(diffHours / 24);
  return `il y a ${diffDays} j`;
}

export default function LastUpdateBadge() {
  const [buildTime, setBuildTime] = useState<Date | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBuildTime() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { buildTime } = await res.json();
        if (!cancelled && buildTime) {
          setBuildTime(new Date(buildTime));
        }
      } catch {
        // Pas critique : on garde le badge silencieux en cas d'échec
      }
    }

    fetchBuildTime();
    setNow(new Date());
    const intervalId = setInterval(() => setNow(new Date()), 30_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  if (!buildTime || !now) return null;

  const formattedDate = buildTime.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      title="Date de la dernière mise à jour de l'application"
      className="fixed right-4 top-4 z-50 rounded-md border border-gray-800 bg-gray-950/90 px-3 py-1.5 text-xs text-gray-400 shadow-lg backdrop-blur-sm"
    >
      <div>Dernière mise à jour : {formattedDate}</div>
      <div className="text-gray-500">{formatRelativeTime(buildTime, now)}</div>
    </div>
  );
}
