"use client";

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { X, Video, Monitor, Mic, Loader2, AlertTriangle, Circle, Square, RefreshCw, Smartphone } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';

export type RecorderMode = 'camera' | 'screen' | 'audio';

/** Heuristique : un iPhone branché (Continuity Camera / USB) apparaît comme un
 *  périphérique vidéo dont le label mentionne l'appareil. */
function isIphoneDevice(label: string) {
  return /iphone|ipad|continuity/i.test(label);
}

function pickMimeType(audioOnly: boolean): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    : [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function extensionFor(mimeType: string | undefined) {
  if (mimeType?.startsWith('video/mp4') || mimeType?.startsWith('audio/mp4')) return 'mp4';
  if (mimeType?.startsWith('audio/ogg')) return 'ogg';
  return 'webm';
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Props = {
  mode: RecorderMode;
  onClose: () => void;
};

export default function RecorderModal({ mode, onClose }: Props) {
  const titleId = useId();
  const { uploadAssetFile, setAssets } = useProject();
  const { toast } = useToast();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // Mode audio : niveau du micro (0..1) mesuré par un AnalyserNode
  const [level, setLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const [deviceId, setDeviceId] = useState<string>('');
  const [withMic, setWithMic] = useState(true);
  const [status, setStatus] = useState<'idle' | 'preparing' | 'ready' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const isRecording = status === 'recording';
  const isBusy = isRecording || status === 'saving';

  const stopLevelMeter = useCallback(() => {
    if (levelRafRef.current !== null) cancelAnimationFrame(levelRafRef.current);
    levelRafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const stopStream = useCallback(() => {
    stopLevelMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopLevelMeter]);

  // Vu-mètre : RMS du signal, rafraîchi à chaque image
  const startLevelMeter = useCallback((stream: MediaStream) => {
    if (typeof AudioContext === 'undefined' || stream.getAudioTracks().length === 0) return;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = ctx;
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
        levelRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // AudioContext indisponible : pas de vu-mètre, l'enregistrement reste possible
    }
  }, []);

  const attachStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    const el = videoRef.current;
    if (el) {
      el.srcObject = stream;
      el.play().catch(() => { /* autoplay refusé : l'aperçu reste figé, sans conséquence */ });
    }
  }, []);

  /** Liste les caméras disponibles (webcam intégrée, iPhone connecté, capture externe). */
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === (mode === 'audio' ? 'audioinput' : 'videoinput')));
    } catch {
      // enumerateDevices indisponible : on garde le périphérique par défaut
    }
  }, [mode]);

  /** Ouvre (ou rouvre) le flux de la source demandée. */
  const openStream = useCallback(async (targetDeviceId?: string) => {
    setError(null);
    setStatus('preparing');
    stopStream();
    try {
      let stream: MediaStream;
      if (mode === 'screen') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: withMic,
        });
        // Si l'utilisateur arrête le partage depuis la barre du navigateur.
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        });
      } else if (mode === 'audio') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: targetDeviceId ? { deviceId: { exact: targetDeviceId } } : true,
        });
        await refreshDevices();
        if (!targetDeviceId) {
          const active = stream.getAudioTracks()[0]?.getSettings().deviceId;
          if (active) setDeviceId(active);
        }
        startLevelMeter(stream);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: targetDeviceId ? { deviceId: { exact: targetDeviceId } } : true,
          audio: withMic,
        });
        // Les labels ne sont lisibles qu'une fois la permission accordée.
        await refreshDevices();
        if (!targetDeviceId) {
          const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
          if (active) setDeviceId(active);
        }
      }
      attachStream(stream);
      setStatus('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Accès au périphérique refusé';
      setError(msg);
      setStatus('idle');
    }
  }, [mode, withMic, attachStream, refreshDevices, stopStream, startLevelMeter]);

  // Ouverture initiale du flux + nettoyage à la fermeture.
  useEffect(() => {
    void openStream();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      stopStream();
    };
    // Volontairement monté une seule fois : les changements de source passent
    // par les handlers explicites (sinon on couperait un enregistrement en cours).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
  }, [refreshDevices]);

  const handleDeviceChange = (id: string) => {
    setDeviceId(id);
    if (!isBusy) void openStream(id);
  };

  const handleMicToggle = (next: boolean) => {
    setWithMic(next);
    // Le flux doit être rouvert pour ajouter/retirer la piste audio.
    if (!isBusy && mode === 'camera') void openStream(deviceId || undefined);
  };

  const saveRecording = useCallback(async (blob: Blob, mimeType: string | undefined) => {
    setStatus('saving');
    try {
      const ext = extensionFor(mimeType);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const prefix = mode === 'screen' ? 'ecran' : mode === 'audio' ? 'micro' : 'webcam';
      const fallbackType = `${mode === 'audio' ? 'audio' : 'video'}/${ext}`;
      const file = new File([blob], `${prefix}-${stamp}.${ext}`, { type: blob.type || fallbackType });
      const asset = await uploadAssetFile(file);
      setAssets((prev) => [...prev, asset]);
      toast({ type: 'success', message: `${file.name} ajouté à la bibliothèque` });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      console.error('[fullcrea] Enregistrement non sauvegardé', e);
      toast({ type: 'error', message: `Enregistrement non sauvegardé : ${msg}` });
      setStatus('ready');
    }
  }, [mode, uploadAssetFile, setAssets, toast, onClose]);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    if (typeof MediaRecorder === 'undefined') {
      setError("Ce navigateur ne supporte pas l'enregistrement (MediaRecorder).");
      return;
    }
    const mimeType = pickMimeType(mode === 'audio');
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      stopStream();
      const blob = new Blob(chunksRef.current, { type: mimeType ?? (mode === 'audio' ? 'audio/webm' : 'video/webm') });
      chunksRef.current = [];
      if (blob.size === 0) {
        setError('Enregistrement vide.');
        setStatus('idle');
        return;
      }
      void saveRecording(blob, mimeType);
    };
    recorderRef.current = recorder;
    recorder.start(1000);
    setElapsed(0);
    setStatus('recording');
    timerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const closable = !isBusy;
  useEscapeKey(onClose, closable);

  const iphones = devices.filter((d) => isIphoneDevice(d.label));
  const title = mode === 'screen' ? "Enregistrer l'écran" : mode === 'audio' ? 'Enregistrer le micro' : 'Enregistrer une vidéo';
  const isAudio = mode === 'audio';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (closable && e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg bg-gray-950 border border-gray-800 rounded-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            {mode === 'screen' ? <Monitor size={16} /> : isAudio ? <Mic size={16} /> : <Video size={16} />}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!closable}
            aria-label="Fermer"
            className="text-gray-500 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className={`relative ${isAudio ? 'h-28' : 'aspect-video'} bg-black rounded overflow-hidden border border-gray-800`}>
            <video ref={videoRef} muted playsInline className={`w-full h-full object-contain ${isAudio ? 'hidden' : ''}`} />
            {isAudio && status !== 'preparing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400">
                <Mic size={28} className={isRecording ? 'text-red-400' : ''} />
                <div className="w-3/4 h-2 bg-gray-800 rounded overflow-hidden" aria-label="Niveau du micro">
                  <div
                    className={`h-full transition-[width] duration-75 ${level > 0.8 ? 'bg-red-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.round(level * 100)}%` }}
                  />
                </div>
                <span className="text-[11px]">{status === 'ready' ? 'Micro prêt — parlez pour voir le niveau' : ' '}</span>
              </div>
            )}
            {status === 'preparing' && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs gap-2">
                <Loader2 size={14} className="animate-spin" /> Préparation de la source…
              </div>
            )}
            {isRecording && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-red-600/90 text-white text-[11px] font-semibold px-2 py-1 rounded">
                <Circle size={8} className="fill-current animate-pulse" />
                REC {formatDuration(elapsed)}
              </div>
            )}
          </div>

          {(mode === 'camera' || isAudio) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor={`${titleId}-source`} className="text-xs font-semibold text-gray-400 uppercase">
                  {isAudio ? 'Micro' : 'Source vidéo'}
                </label>
                <button
                  type="button"
                  onClick={() => void refreshDevices()}
                  title="Rafraîchir la liste des caméras"
                  className="text-gray-500 hover:text-white transition p-1 rounded disabled:opacity-40"
                  disabled={isBusy}
                >
                  <RefreshCw size={12} />
                </button>
              </div>
              <select
                id={`${titleId}-source`}
                value={deviceId}
                onChange={(e) => handleDeviceChange(e.target.value)}
                disabled={isBusy || devices.length === 0}
                className="w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
              >
                {devices.length === 0 && <option value="">{isAudio ? 'Micro par défaut' : 'Caméra par défaut'}</option>}
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {isIphoneDevice(d.label) ? '📱 ' : ''}{d.label || `${isAudio ? 'Micro' : 'Caméra'} ${i + 1}`}
                  </option>
                ))}
              </select>
              {!isAudio && (
                <div className="text-[11px] text-gray-600 leading-snug flex items-start gap-1.5">
                  <Smartphone size={11} className="shrink-0 mt-0.5" />
                  {iphones.length > 0
                    ? "Un iPhone est détecté : sélectionnez-le pour filmer depuis le téléphone."
                    : "Webcam ou iPhone connecté (Continuity Camera / USB) : branchez-le puis rafraîchissez la liste."}
                </div>
              )}
            </div>
          )}

          {!isAudio && (
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={withMic}
              onChange={(e) => handleMicToggle(e.target.checked)}
              disabled={isBusy}
              className="accent-blue-600"
            />
            {mode === 'screen' ? "Inclure l'audio partagé" : 'Enregistrer le micro'}
          </label>
          )}

          {mode === 'screen' && (
            <div className="text-[11px] text-gray-600 leading-snug">
              La fenêtre ou l&apos;écran partagé est choisi par le navigateur.{' '}
              <button
                type="button"
                onClick={() => void openStream()}
                disabled={isBusy}
                className="text-blue-400 hover:text-blue-300 underline disabled:opacity-40"
              >
                Changer de partage
              </button>
            </div>
          )}

          {error && (
            <div className="text-[11px] text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
              <div className="break-words leading-snug">{error}</div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {status === 'idle' && !isRecording && (
              <button
                type="button"
                onClick={() => void openStream(deviceId || undefined)}
                className="flex-1 flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white py-2 rounded text-sm font-medium transition"
              >
                <RefreshCw size={14} /> Réessayer
              </button>
            )}
            {!isRecording ? (
              <button
                type="button"
                onClick={startRecording}
                disabled={status !== 'ready'}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition"
              >
                {status === 'saving'
                  ? <><Loader2 size={14} className="animate-spin" /> Ajout à la bibliothèque…</>
                  : <><Circle size={12} className="fill-current" /> Démarrer l&apos;enregistrement</>}
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-gray-200 text-gray-900 py-2 rounded text-sm font-medium transition"
              >
                <Square size={12} className="fill-current" /> Arrêter ({formatDuration(elapsed)})
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
