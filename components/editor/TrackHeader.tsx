"use client";

import { useState } from 'react';
import { Lock, Plus, Mic, Music, Square, Loader2, MessageSquareText } from 'lucide-react';
import type { Track } from '@/components/ProjectContext';
import { useMicRecorder, type MicRecording } from '@/lib/hooks/useMicRecorder';

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface TrackHeaderProps {
  track: Track;
  width: number;
  className: string;
  /** Voix Off : ouvre la modale texte → parole */
  onAddVoiceOver?: () => void;
  /** Musique : ouvre le choix d'un audio de la bibliothèque */
  onAddMusic?: () => void;
  /** Micro : position de la tête au démarrage, puis le fichier enregistré */
  getMicStartPx?: () => number;
  onMicRecorded?: (recording: MicRecording, startPx: number) => Promise<void> | void;
  onMicError?: (message: string) => void;
}

const smallButton =
  'shrink-0 flex items-center justify-center rounded transition ' +
  '[@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:min-w-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

/**
 * En-tête (gouttière) d'une piste : nom, cadenas, et le bouton propre aux
 * pistes spéciales — « + » Voix Off / Musique, « ● REC » Micro (visible au
 * survol, toujours présent en tactile).
 */
export default function TrackHeader({
  track, width, className, onAddVoiceOver, onAddMusic, getMicStartPx, onMicRecorded, onMicError,
}: TrackHeaderProps) {
  const recorder = useMicRecorder();
  const [startPx, setStartPx] = useState(0);
  const [saving, setSaving] = useState(false);
  const locked = !!track.locked;

  const startMic = async () => {
    const at = getMicStartPx?.() ?? 0;
    setStartPx(at);
    try {
      await recorder.start();
    } catch (e) {
      onMicError?.(e instanceof Error ? e.message : 'Accès au micro refusé');
    }
  };

  const stopMic = async () => {
    const rec = await recorder.stop();
    if (!rec) {
      onMicError?.('Enregistrement vide');
      return;
    }
    setSaving(true);
    try {
      await onMicRecorded?.(rec, startPx);
    } finally {
      setSaving(false);
    }
  };

  const isRecording = recorder.status === 'recording';
  const isBusy = recorder.status === 'starting' || recorder.status === 'stopping' || saving;

  return (
    <div
      data-track-header=""
      // Aucun clic ici ne doit démarrer un pan, un scrub ni créer un texte
      onPointerDown={(e) => e.stopPropagation()}
      className={`group/header sticky left-0 h-full border-r border-gray-700 z-40 flex items-center gap-1 px-1.5 text-[10px] font-bold uppercase tracking-tighter ${className} ${isRecording ? 'bg-red-950/60 text-red-200' : ''}`}
      style={{ width }}
    >
      {track.kind === 'voiceover' && <MessageSquareText size={12} className="shrink-0 opacity-70" aria-hidden="true" />}
      {track.kind === 'music' && <Music size={12} className="shrink-0 opacity-70" aria-hidden="true" />}
      {track.kind === 'mic' && !isRecording && <Mic size={12} className="shrink-0 opacity-70" aria-hidden="true" />}

      <span className="truncate flex-1 min-w-0">
        {isRecording ? formatDuration(recorder.elapsed) : track.name}
      </span>

      {locked && <Lock size={12} className="shrink-0 opacity-80" aria-label="Piste verrouillée" />}

      {!locked && track.kind === 'voiceover' && (
        <button
          type="button"
          onClick={onAddVoiceOver}
          title="Ajouter une voix off (texte → parole)"
          aria-label="Ajouter une voix off"
          className={`${smallButton} w-6 h-6 bg-emerald-600 hover:bg-emerald-500 text-white`}
        >
          <Plus size={14} strokeWidth={3} />
        </button>
      )}

      {!locked && track.kind === 'music' && (
        <button
          type="button"
          onClick={onAddMusic}
          title="Ajouter une musique"
          aria-label="Ajouter une musique"
          className={`${smallButton} w-6 h-6 bg-purple-600 hover:bg-purple-500 text-white`}
        >
          <Plus size={14} strokeWidth={3} />
        </button>
      )}

      {!locked && track.kind === 'mic' && (
        isRecording ? (
          <button
            type="button"
            onClick={stopMic}
            disabled={isBusy}
            title="Arrêter et placer l'enregistrement sur la piste"
            aria-label="Arrêter l'enregistrement"
            className={`${smallButton} w-7 h-7 bg-white hover:bg-gray-200 text-red-600 disabled:opacity-60`}
          >
            <Square size={12} className="fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={startMic}
            disabled={isBusy}
            title="Enregistrer le micro sur cette piste"
            aria-label="Enregistrer le micro"
            // Visible au survol (souris) ; toujours visible, atténué, en tactile
            className={`${smallButton} w-7 h-7 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-900/40
              opacity-60 group-hover/header:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 disabled:opacity-60`}
          >
            {isBusy
              ? <Loader2 size={12} className="animate-spin" />
              : <span className="block w-2.5 h-2.5 rounded-full bg-white" aria-hidden="true" />}
          </button>
        )
      )}
    </div>
  );
}
