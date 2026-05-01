"use client";

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

// Single-threaded build : pas besoin des headers COOP/COEP, mais plus lent.
// Si on veut le multi-thread plus tard, remplacer par /umd/ et ajouter
// les headers Cross-Origin-Opener-Policy / Embedder-Policy dans next.config.
const CORE_VERSION = '0.12.10';
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let cached: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (cached) return cached;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ff = new FFmpeg();
    if (onLog) ff.on('log', ({ message }) => onLog(message));

    await ff.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    cached = ff;
    return ff;
  })();

  return loadingPromise;
}
