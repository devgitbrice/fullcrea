"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Download, ChevronDown, Loader2, AlertTriangle, Clock } from 'lucide-react';
import { useProject, defaultImageTransform } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { useBeforeUnload } from '@/lib/hooks/useBeforeUnload';
import { renderProjectToMp4 } from '@/lib/export/render';

const RESOLUTIONS = [
  { id: 'hd',   label: 'Full HD — 1920 × 1080', width: 1920, height: 1080 },
  { id: 'qhd',  label: '2K QHD — 2560 × 1440',  width: 2560, height: 1440 },
  { id: 'uhd',  label: '4K UHD — 3840 × 2160',  width: 3840, height: 2160 },
] as const;

type ResolutionId = (typeof RESOLUTIONS)[number]['id'];

// Les clips stockent start/width en pixels à zoom=1 → 30 px/s.
const PIXELS_PER_SECOND = 30;

const DEFAULT_TRANSFORM_JSON = JSON.stringify(defaultImageTransform);

function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function ExportButton() {
  // Export de la timeline active, timelines imbriquées dépliées
  const { flatClips: clips, allTracks: tracks, currentProject, projectSettings, projectDurationPx } = useProject();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<ResolutionId>('hd');
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const hasClips = clips.length > 0;
  const durationLabel = formatSeconds(projectDurationPx / PIXELS_PER_SECOND);

  const { hasText, hasTransforms } = useMemo(() => ({
    hasText: clips.some((c) => c.type === 'text'),
    hasTransforms: clips.some(
      (c) => c.type === 'image' && !!c.transform && JSON.stringify(c.transform) !== DEFAULT_TRANSFORM_JSON
    ),
  }), [clips]);

  const close = useCallback(() => setOpen(false), []);
  useEscapeKey(close, open && !rendering);
  useBeforeUnload(rendering);

  useEffect(() => {
    if (!open || rendering) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, rendering]);

  const handleExport = async () => {
    if (!hasClips || rendering) return;
    const r = RESOLUTIONS.find((x) => x.id === resolution)!;
    setError(null);
    setRendering(true);
    setProgress({ stage: 'Chargement de ffmpeg…', percent: 0 });

    try {
      const blob = await renderProjectToMp4({
        clips,
        tracks,
        pixelsPerSecond: PIXELS_PER_SECOND,
        width: r.width,
        height: r.height,
        fps: projectSettings.fps,
        onProgress: setProgress,
      });

      // Téléchargement
      const safeName = currentProject.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'export';
      const filename = `${safeName}_${r.width}x${r.height}.mp4`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast({ type: 'success', message: `Export terminé : ${filename}` });
      setOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erreur inconnue';
      setError(message);
      toast({ type: 'error', message: `Échec de l'export : ${message}` });
    } finally {
      setRendering(false);
      setProgress(null);
    }
  };

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={rendering}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 text-white px-3 py-1.5 rounded text-xs font-semibold transition shadow-md shadow-orange-900/30"
      >
        {rendering ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        Exporter
        {!rendering && <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Options d'export"
          className="absolute right-0 top-full mt-2 w-80 bg-gray-950 border border-gray-800 rounded-md shadow-2xl z-50 p-3 space-y-3"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-800">
            <span className="text-xs font-semibold text-gray-200">Options d&apos;export</span>
            <span
              className="flex items-center gap-1 text-[11px] text-gray-400 tabular-nums"
              title="Durée estimée du projet"
            >
              <Clock size={11} className="text-gray-500" />
              {durationLabel}
            </span>
          </div>

          <div>
            <label
              htmlFor="export-resolution"
              className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5"
            >
              Résolution
            </label>
            <select
              id="export-resolution"
              value={resolution}
              onChange={(e) => setResolution(e.target.value as ResolutionId)}
              disabled={rendering}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-orange-600"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          {progress && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-gray-300">
                <span className="flex items-center gap-1.5">
                  <Loader2 size={10} className="animate-spin" />
                  {progress.stage}
                </span>
                <span className="text-gray-500">{Math.round(progress.percent)}%</span>
              </div>
              <div className="h-1.5 bg-gray-900 rounded overflow-hidden">
                <div
                  className="h-full bg-orange-500 transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {(hasText || hasTransforms) && (
            <div className="text-xs text-amber-200 bg-amber-950/40 border border-amber-900 rounded p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber-400" />
              <span className="break-words">
                Les textes et les transformations d&apos;image ne sont pas encore inclus dans l&apos;export.
              </span>
            </div>
          )}

          {!hasClips && (
            <p className="text-[11px] text-gray-400">
              Ajoutez des clips à la timeline pour exporter.
            </p>
          )}

          <button
            type="button"
            onClick={handleExport}
            disabled={rendering || !hasClips}
            className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-xs font-semibold transition"
          >
            {rendering ? <><Loader2 size={13} className="animate-spin" /> En cours…</> : <><Download size={13} /> Lancer l&apos;export</>}
          </button>

          <p className="text-[10px] text-gray-500 leading-snug">
            Rendu local via ffmpeg.wasm (~1× temps réel en HD, plus lent en 4K). Ne ferme pas l&apos;onglet.
          </p>
        </div>
      )}
    </div>
  );
}
