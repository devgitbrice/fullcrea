"use client";

// Moteur de rendu de Gennn Audio, dans une iframe invisible
// (audio.gennn.live/embed/render) : il reçoit le projet et renvoie le mix en
// WAV. Le son est ensuite lu par Gennn Cut comme un clip audio ordinaire.

import { GENNN_AUDIO_URL } from './api';

const RENDER_TIMEOUT_MS = 5 * 60_000;
const READY_TIMEOUT_MS = 20_000;
const origin = new URL(GENNN_AUDIO_URL).origin;

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let counter = 0;
const pending = new Map<string, { resolve: (r: { wav: ArrayBuffer; duration: number }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function onMessage(e: MessageEvent) {
  if (e.origin !== origin) return;
  const data = e.data as { type?: string; id?: string; wav?: ArrayBuffer; duration?: number; message?: string } | null;
  if (!data?.id) return;
  const job = pending.get(data.id);
  if (!job) return;
  if (data.type === 'ga:rendered' && data.wav) {
    pending.delete(data.id);
    clearTimeout(job.timer);
    job.resolve({ wav: data.wav, duration: data.duration ?? 0 });
  } else if (data.type === 'ga:error') {
    pending.delete(data.id);
    clearTimeout(job.timer);
    job.reject(new Error(data.message || 'Rendu Gennn Audio impossible'));
  }
}

function ensureFrame(): Promise<void> {
  if (ready) return ready;
  window.addEventListener('message', onMessage);
  ready = new Promise<void>((resolve, reject) => {
    const el = document.createElement('iframe');
    el.src = `${GENNN_AUDIO_URL}/embed/render`;
    el.title = 'Gennn Audio — moteur de rendu';
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    el.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none;border:0';
    const timer = setTimeout(() => {
      window.removeEventListener('message', onReady);
      reject(new Error('Le moteur Gennn Audio ne répond pas'));
    }, READY_TIMEOUT_MS);
    const onReady = (e: MessageEvent) => {
      if (e.origin !== origin || (e.data as { type?: string })?.type !== 'ga:ready') return;
      clearTimeout(timer);
      window.removeEventListener('message', onReady);
      resolve();
    };
    window.addEventListener('message', onReady);
    document.body.appendChild(el);
    frame = el;
  });
  // Échec : on retentera avec une iframe neuve
  ready.catch(() => {
    frame?.remove();
    frame = null;
    ready = null;
  });
  return ready;
}

/** Calcule le mix d'un projet Gennn Audio (document + URL des enregistrements). */
export async function renderGennnAudio(set: unknown, samples: Record<string, string>): Promise<{ wav: ArrayBuffer; duration: number }> {
  await ensureFrame();
  const id = `r${++counter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Rendu Gennn Audio trop long'));
    }, RENDER_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    frame?.contentWindow?.postMessage({ type: 'ga:render', id, set, samples }, origin);
  });
}
