"use client";

/**
 * Petit « ding » à deux notes, synthétisé par la Web Audio API : le lecteur
 * public signale ainsi qu'une mise à jour du projet est disponible, sans
 * embarquer de fichier son. Silencieux si le navigateur bloque l'audio
 * (aucune interaction préalable) : la notification visuelle suffit alors.
 */
export async function playUpdateChime(): Promise<void> {
  try {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') await ctx.resume();

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.connect(ctx.destination);

    // Deux notes montantes (La5 puis Do#6), très courtes
    [880, 1108.73].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const start = now + i * 0.12;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + 0.14);
    });

    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    setTimeout(() => { ctx.close().catch(() => {}); }, 800);
  } catch {
    // Audio indisponible : on se contente de la pastille visuelle
  }
}
