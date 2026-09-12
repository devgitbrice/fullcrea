"use client";

// Probe asynchrone de la durée d'un média (secondes), sans le lire.
// Renvoie null si la durée est inconnue ou si le média ne charge pas (8 s max).
export function probeMediaDuration(src: string, kind: 'video' | 'audio'): Promise<number | null> {
  return new Promise((resolve) => {
    const el = (kind === 'video' ? document.createElement('video') : document.createElement('audio')) as HTMLMediaElement;
    el.preload = 'metadata';
    el.muted = true;
    let done = false;
    const finish = (val: number | null) => {
      if (done) return;
      done = true;
      el.src = '';
      try { el.removeAttribute('src'); el.load(); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 8000);
    el.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      const d = el.duration;
      finish(isFinite(d) && d > 0 ? d : null);
    }, { once: true });
    el.addEventListener('error', () => { clearTimeout(timer); finish(null); }, { once: true });
    try { el.src = src; } catch { finish(null); }
  });
}
