"use client";

import { shouldIgnoreShortcut } from '@/lib/keyboard';
import { useEffect } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;
const ZOOM_STEP_IN = 1.25;
const ZOOM_STEP_OUT = 0.8;
// La toolbar ne connaît pas la largeur du viewport de la timeline : on
// retranche la sidebar et on vise ~90 % de la largeur restante.
const FIT_SIDEBAR_WIDTH_PX = 320;
const FIT_RATIO = 0.9;
const FIT_MIN_DURATION_PX = 30 * 10;

const clampZoom = (value: number) => Math.min(Math.max(ZOOM_MIN, value), ZOOM_MAX);

const buttonClass =
  'p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent';

export default function ZoomControls() {
  const { zoomLevel, setZoomLevel, projectDurationPx } = useProject();

  const zoomOut = () => setZoomLevel(prev => clampZoom(prev * ZOOM_STEP_OUT));
  const zoomIn = () => setZoomLevel(prev => clampZoom(prev * ZOOM_STEP_IN));
  const resetZoom = () => setZoomLevel(1);
  const fitZoom = () => {
    if (typeof window === 'undefined') return;
    const available = (window.innerWidth - FIT_SIDEBAR_WIDTH_PX) * FIT_RATIO;
    setZoomLevel(clampZoom(available / Math.max(projectDurationPx, FIT_MIN_DURATION_PX)));
  };

  // Raccourcis + / - : Ctrl/Cmd reste le zoom du navigateur ; Maj n'est pas
  // bloqué car "+" exige Maj sur AZERTY comme sur QWERTY, et "=" accepte le
  // QWERTY sans Maj.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (shouldIgnoreShortcut(e)) return;
      if (e.key === '-') {
        e.preventDefault();
        setZoomLevel(prev => clampZoom(prev * ZOOM_STEP_OUT));
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomLevel(prev => clampZoom(prev * ZOOM_STEP_IN));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setZoomLevel]);

  const canZoomOut = zoomLevel > ZOOM_MIN;
  const canZoomIn = zoomLevel < ZOOM_MAX;
  const isDefaultZoom = Math.abs(zoomLevel - 1) < 0.001;

  return (
    <div
      role="group"
      aria-label="Zoom de la timeline"
      className="flex items-center gap-2 bg-gray-800 px-2 py-1 rounded-md border border-gray-700"
    >
      <button
        onClick={zoomOut}
        disabled={!canZoomOut}
        className={buttonClass}
        title="Zoom arrière (-)"
        aria-label="Zoom arrière"
      >
        <ZoomOut size={14} />
      </button>
      <input
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={0.05}
        value={zoomLevel}
        onChange={(e) => {
          const next = parseFloat(e.target.value);
          if (!Number.isNaN(next)) setZoomLevel(clampZoom(next));
        }}
        className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
        aria-label="Niveau de zoom"
      />
      <button
        onClick={zoomIn}
        disabled={!canZoomIn}
        className={buttonClass}
        title="Zoom avant (+)"
        aria-label="Zoom avant"
      >
        <ZoomIn size={14} />
      </button>
      <span className="text-[10px] font-mono text-gray-500 w-10 text-right tabular-nums">
        {Math.round(zoomLevel * 100)}%
      </span>

      <div className="w-px h-4 bg-gray-700" aria-hidden="true" />

      <button
        onClick={fitZoom}
        className={`${buttonClass} flex items-center gap-1 text-[10px] font-medium`}
        title="Ajuster le zoom au projet"
        aria-label="Ajuster le zoom au projet"
      >
        <Maximize2 size={12} />
        Ajuster
      </button>
      <button
        onClick={resetZoom}
        disabled={isDefaultZoom}
        className={`${buttonClass} text-[10px] font-mono`}
        title="Réinitialiser le zoom à 100 %"
        aria-label="Réinitialiser le zoom à 100 %"
      >
        100%
      </button>
    </div>
  );
}
