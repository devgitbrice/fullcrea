"use client";

const AUDIO_APP_URL = "https://audio.gennn.live";

export default function AudioLinkButton() {
  return (
    <button
      type="button"
      title="Ouvrir audio.gennn.live"
      onClick={() => window.open(AUDIO_APP_URL, "_blank", "noopener,noreferrer")}
      className="flex h-9 items-center gap-1.5 rounded-md border border-gray-800 bg-gray-950/90 px-3 text-xs font-medium text-gray-200 shadow-lg backdrop-blur-sm transition-colors hover:bg-gray-800"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
      Audio
    </button>
  );
}
