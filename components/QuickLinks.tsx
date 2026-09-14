"use client";

import { ExternalLink } from "lucide-react";

const APP_URL = "https://app.gennn.live/login";

// Lien vers l'application principale, affiché en bas à droite une fois connecté
export default function QuickLinks() {
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <a
        href={APP_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Ouvrir app.gennn.live"
        className="flex h-10 items-center gap-1.5 rounded-full border border-gray-800 bg-gray-950 px-4 text-sm font-semibold text-gray-200 shadow-2xl transition-colors hover:bg-gray-800"
      >
        APP
        <ExternalLink size={14} className="text-gray-500" />
      </a>
    </div>
  );
}
