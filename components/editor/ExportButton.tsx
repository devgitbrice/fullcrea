"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Download, ChevronDown, Loader2, AlertTriangle, Clock, Link2, Code2, Copy, Check, ExternalLink, RefreshCw,
} from 'lucide-react';
import { useProject, defaultImageTransform } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { useBeforeUnload } from '@/lib/hooks/useBeforeUnload';
import { renderProjectToMp4 } from '@/lib/export/render';
import { getSupabase, getCurrentUser } from '@/lib/supabase/client';
import { createShare, type Share } from '@/lib/supabase/sharesRepo';

const RESOLUTIONS = [
  { id: 'hd',   label: 'Full HD — 1920 × 1080', width: 1920, height: 1080 },
  { id: 'qhd',  label: '2K QHD — 2560 × 1440',  width: 2560, height: 1440 },
  { id: 'uhd',  label: '4K UHD — 3840 × 2160',  width: 3840, height: 2160 },
] as const;

type ResolutionId = (typeof RESOLUTIONS)[number]['id'];

// Trois façons de sortir le montage : fichier, lien à envoyer, code à intégrer
const MODES = [
  { id: 'download', label: 'Fichier', Icon: Download, action: 'Lancer l\'export' },
  { id: 'link',     label: 'Lien',    Icon: Link2,    action: 'Créer le lien de partage' },
  { id: 'embed',    label: 'Héberger', Icon: Code2,   action: 'Générer le code' },
] as const;

type ModeId = (typeof MODES)[number]['id'];

/** Copie dans le presse-papiers, avec repli pour les navigateurs sans API. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

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
  const {
    flatClips: clips, allTracks: tracks, currentProject, projectSettings, projectDurationPx, isPersistenceCloud,
  } = useProject();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ModeId>('download');
  const [resolution, setResolution] = useState<ResolutionId>('hd');
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Partage créé dans cette session : lien et code d'intégration en découlent
  const [share, setShare] = useState<Share | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const shareUrl = share ? `${origin}/v/${share.id}` : '';
  const embedCode = share
    ? `<iframe src="${origin}/embed/${share.id}" width="${share.width}" height="${share.height}" `
      + `style="border:0;max-width:100%;aspect-ratio:${share.width}/${share.height}" `
      + `allow="fullscreen; autoplay" title="${currentProject.name.replace(/"/g, '&quot;')}"></iframe>`
    : '';

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const handleCopy = useCallback(async (key: string, text: string) => {
    const ok = await copyText(text);
    if (!ok) {
      toast({ type: 'error', message: 'Copie impossible : sélectionne le texte et copie-le à la main' });
      return;
    }
    setCopied(key);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(null), 2000);
  }, [toast]);

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

  // Rendu commun aux trois modes : téléchargement, lien et intégration
  // partagent exactement le même MP4.
  const renderMp4 = async () => {
    const r = RESOLUTIONS.find((x) => x.id === resolution)!;
    setProgress({ stage: 'Chargement de ffmpeg…', percent: 0 });
    const blob = await renderProjectToMp4({
      clips,
      tracks,
      pixelsPerSecond: PIXELS_PER_SECOND,
      width: r.width,
      height: r.height,
      fps: projectSettings.fps,
      onProgress: setProgress,
    });
    return { blob, width: r.width, height: r.height };
  };

  const handleDownload = async () => {
    const { blob, width, height } = await renderMp4();
    const safeName = currentProject.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'export';
    const filename = `${safeName}_${width}x${height}.mp4`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast({ type: 'success', message: `Export terminé : ${filename}` });
    setOpen(false);
  };

  // Rend la vidéo, la dépose dans le bucket public et crée la ligne de partage.
  // Le lien et le code d'intégration pointent tous deux vers ce partage.
  const handlePublish = async () => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Supabase n'est pas configuré : le partage par lien est indisponible.");
    const user = await getCurrentUser(supabase);
    if (!user) throw new Error('Session expirée : reconnecte-toi pour publier un lien.');

    const { blob, width, height } = await renderMp4();
    setProgress({ stage: 'Envoi de la vidéo…', percent: 95 });
    const created = await createShare(supabase, user.id, {
      projectId: currentProject.id,
      title: currentProject.name,
      blob,
      width,
      height,
      durationSec: projectDurationPx / PIXELS_PER_SECOND,
    });
    setShare(created);
    toast({ type: 'success', message: 'Lien de partage créé' });
  };

  const handleRun = async () => {
    if (!hasClips || rendering) return;
    setError(null);
    setRendering(true);
    try {
      if (mode === 'download') await handleDownload();
      else await handlePublish();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erreur inconnue';
      setError(message);
      toast({ type: 'error', message: `Échec : ${message}` });
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
          className="absolute right-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-2rem)] bg-gray-950 border border-gray-800 rounded-md shadow-2xl z-50 p-3 space-y-3"
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

          {/* Trois sorties : fichier, lien à envoyer, code à intégrer */}
          <div role="group" aria-label="Type d'export" className="grid grid-cols-3 gap-1 bg-gray-900 p-1 rounded border border-gray-800">
            {MODES.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => { setMode(id); setError(null); }}
                disabled={rendering}
                aria-pressed={mode === id}
                className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-semibold transition disabled:opacity-50 ${
                  mode === id ? 'bg-orange-600 text-white shadow-sm' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
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

          {/* Partage et intégration : le fichier est hébergé, il faut le cloud */}
          {mode !== 'download' && !isPersistenceCloud && (
            <div className="text-xs text-amber-200 bg-amber-950/40 border border-amber-900 rounded p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber-400" />
              <span className="break-words">
                Le lien et l&apos;intégration nécessitent Supabase (la vidéo est hébergée). En mode local, seul le
                téléchargement du fichier est possible.
              </span>
            </div>
          )}

          {mode !== 'download' && share ? (
            <div className="space-y-2">
              {mode === 'link' ? (
                <>
                  <label htmlFor="share-url" className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Lien à envoyer
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      id="share-url"
                      readOnly
                      value={shareUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 min-w-0 bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-[11px] text-gray-200 font-mono focus:outline-none focus:border-orange-600"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopy('url', shareUrl)}
                      title="Copier le lien"
                      aria-label="Copier le lien"
                      className="shrink-0 p-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
                    >
                      {copied === 'url' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    </button>
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Ouvrir le lecteur"
                      aria-label="Ouvrir le lecteur"
                      className="shrink-0 p-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-snug">
                    N&apos;importe qui avec ce lien peut voir la vidéo dans un lecteur, sans compte.
                  </p>
                </>
              ) : (
                <>
                  <label htmlFor="embed-code" className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Code à coller dans ta page
                  </label>
                  <textarea
                    id="embed-code"
                    readOnly
                    rows={4}
                    value={embedCode}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-[10px] text-gray-200 font-mono resize-none focus:outline-none focus:border-orange-600"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopy('embed', embedCode)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-[11px] font-semibold text-gray-200 transition"
                    >
                      {copied === 'embed' ? <><Check size={12} className="text-emerald-400" /> Copié</> : <><Copy size={12} /> Copier le code</>}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy('mp4', share.src)}
                      title="Copier l'URL directe du MP4"
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-[11px] font-semibold text-gray-200 transition"
                    >
                      {copied === 'mp4' ? <><Check size={12} className="text-emerald-400" /> Copié</> : <><Copy size={12} /> URL du MP4</>}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-snug">
                    Le lecteur s&apos;affiche dans une iframe ; l&apos;URL du MP4 sert pour une balise
                    &lt;video&gt; ou un autre lecteur.
                  </p>
                </>
              )}

              <button
                type="button"
                onClick={() => { setShare(null); setError(null); }}
                disabled={rendering}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-[11px] text-gray-400 hover:text-white hover:bg-gray-800 transition disabled:opacity-50"
              >
                <RefreshCw size={11} /> Publier une nouvelle version
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleRun}
              disabled={rendering || !hasClips || (mode !== 'download' && !isPersistenceCloud)}
              className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-xs font-semibold transition"
            >
              {rendering
                ? <><Loader2 size={13} className="animate-spin" /> En cours…</>
                : <>{(() => { const M = MODES.find((m) => m.id === mode)!; return <M.Icon size={13} />; })()} {MODES.find((m) => m.id === mode)!.action}</>}
            </button>
          )}

          <p className="text-[10px] text-gray-500 leading-snug">
            Rendu local via ffmpeg.wasm (~1× temps réel en HD, plus lent en 4K). Ne ferme pas l&apos;onglet.
          </p>
        </div>
      )}
    </div>
  );
}
