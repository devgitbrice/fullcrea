"use client";

import { useEffect, useId, useRef, useState, FormEvent } from 'react';
import { X, Loader2, MessageSquareText, AlertTriangle } from 'lucide-react';
import { useProject, PX_PER_SEC_BASE, type Clip } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { useBeforeUnload } from '@/lib/hooks/useBeforeUnload';
import { newId } from '@/lib/timeline/clipOps';
import { probeMediaDuration } from '@/lib/media/probe';
import { OPENAI_VOICES, DEFAULT_OPENAI_VOICE } from '@/lib/openai/voices';

const INITIAL_WIDTH_PX = 150;

async function readJsonError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

interface VoiceOverModalProps {
  trackId: number;
  /** Clip existant à modifier : le texte est prérempli et la voix régénérée */
  clip?: Clip;
  onClose: () => void;
}

/**
 * Voix off « ChatGPT » : le texte saisi est converti en parole (OpenAI TTS),
 * uploadé comme média et posé sur la piste Voix Off à la tête de lecture. En
 * édition, le clip garde sa place et reçoit le nouvel audio.
 */
export default function VoiceOverModal({ trackId, clip, onClose }: VoiceOverModalProps) {
  const titleId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { uploadAssetFile, setAssets, insertClipOnTrack, updateClipFields, currentTimeRef } = useProject();
  const { toast } = useToast();

  const [text, setText] = useState(clip?.tts?.text ?? '');
  const [voice, setVoice] = useState<string>(clip?.tts?.voice ?? DEFAULT_OPENAI_VOICE);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !loading && text.trim().length > 0;
  useEscapeKey(onClose, !loading);
  useBeforeUnload(loading);
  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      setStatus('Génération de la voix…');
      const res = await fetch('/api/openai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), voice }),
      });
      if (!res.ok) throw new Error(await readJsonError(res));
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const file = new File([blob], `voix-off-${stamp}.mp3`, { type: blob.type || 'audio/mpeg' });

      setStatus('Ajout à la bibliothèque…');
      const asset = await uploadAssetFile(file);
      setAssets((prev) => [...prev, asset]);

      setStatus('Mesure de la durée…');
      const seconds = await probeMediaDuration(asset.src, 'audio');
      const width = seconds ? Math.max(1, seconds * PX_PER_SEC_BASE) : INITIAL_WIDTH_PX;
      const tts = { text: text.trim(), voice };
      // Nom lisible sur la timeline : début du texte
      const name = text.trim().replace(/\s+/g, ' ').slice(0, 40) || asset.name;

      if (clip) {
        updateClipFields(clip.id, {
          name, src: asset.src, width, offset: 0,
          sourceDuration: seconds ? width : undefined, tts,
        });
        toast({ type: 'success', message: 'Voix off régénérée' });
      } else {
        insertClipOnTrack({
          id: newId('vo'), name, type: 'audio', src: asset.src,
          start: Math.max(0, currentTimeRef.current), width,
          sourceDuration: seconds ? width : undefined, tts,
        }, trackId);
        toast({ type: 'success', message: 'Voix off ajoutée à la piste' });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (!loading && e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg bg-gray-950 border border-gray-800 rounded-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            <MessageSquareText size={16} className="text-emerald-400" />
            <h2 id={titleId}>{clip ? 'Modifier la voix off' : 'Nouvelle voix off'}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Fermer"
            className="text-gray-500 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-gray-400 uppercase">Texte à dire</span>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={loading}
              rows={5}
              maxLength={4096}
              placeholder="Tapez le texte de la voix off…"
              className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-emerald-600 disabled:opacity-50 resize-y"
            />
            <span className="block text-[10px] text-gray-600 text-right">{text.length} / 4096</span>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold text-gray-400 uppercase">Voix (OpenAI)</span>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              disabled={loading}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
            >
              {OPENAI_VOICES.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
          </label>

          {error && (
            <div className="text-[11px] text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
              <div className="break-words leading-snug">{error}</div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-gray-500 truncate">
              {loading ? status : clip ? 'La voix sera régénérée, le clip garde sa place.' : 'Posée à la tête de lecture.'}
            </span>
            <button
              type="submit"
              disabled={!canSubmit}
              className="shrink-0 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-sm font-medium transition"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <MessageSquareText size={14} />}
              {clip ? 'Régénérer' : 'Générer la voix'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
