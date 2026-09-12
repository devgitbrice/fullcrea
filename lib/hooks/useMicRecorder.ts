"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

export type MicRecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping';

export interface MicRecording {
  blob: Blob;
  mimeType: string;
  extension: 'webm' | 'mp4' | 'ogg';
}

function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

function extensionFor(mimeType: string | undefined): MicRecording['extension'] {
  if (mimeType?.startsWith('audio/mp4')) return 'mp4';
  if (mimeType?.startsWith('audio/ogg')) return 'ogg';
  return 'webm';
}

/**
 * Enregistrement du micro (MediaRecorder). start() demande la permission et
 * démarre, stop() résout avec le fichier audio ; cancel() jette tout.
 */
export function useMicRecorder() {
  const [status, setStatus] = useState<MicRecorderStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopResolveRef = useRef<((r: MicRecording | null) => void) | null>(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);
    setStatus('starting');
    try {
      if (typeof MediaRecorder === 'undefined') throw new Error("Ce navigateur ne supporte pas l'enregistrement (MediaRecorder).");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => { if (ev.data.size > 0) chunksRef.current.push(ev.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;
        releaseStream();
        setStatus('idle');
        const resolve = stopResolveRef.current;
        stopResolveRef.current = null;
        resolve?.(blob.size > 0 ? { blob, mimeType: type, extension: extensionFor(type) } : null);
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start(1000);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
      setStatus('recording');
    } catch (e) {
      releaseStream();
      recorderRef.current = null;
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Accès au micro refusé');
      throw e;
    }
  }, [releaseStream]);

  const stop = useCallback((): Promise<MicRecording | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return Promise.resolve(null);
    setStatus('stopping');
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      recorder.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    stopResolveRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    setStatus('idle');
  }, [releaseStream]);

  // Démontage : on coupe le micro
  useEffect(() => cancel, [cancel]);

  return { status, elapsed, error, start, stop, cancel };
}
