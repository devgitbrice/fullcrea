import { NextRequest } from 'next/server';
import { DEFAULT_OPENAI_VOICE, isOpenAIVoice } from '@/lib/openai/voices';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const MAX_CHARS = 4096; // limite d'entrée de l'API Speech

// Voix off « ChatGPT » : texte → MP3 via l'API Speech d'OpenAI.
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY manquante côté serveur' }, { status: 500 });
  }

  let text: string;
  let voice: string;
  try {
    const body = await req.json();
    text = String(body.text ?? '').trim();
    voice = String(body.voice ?? DEFAULT_OPENAI_VOICE);
  } catch {
    return Response.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!text) return Response.json({ error: 'Texte vide' }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return Response.json({ error: `Texte trop long (${text.length} caractères, max ${MAX_CHARS})` }, { status: 400 });
  }
  if (!isOpenAIVoice(voice)) voice = DEFAULT_OPENAI_VOICE;

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || DEFAULT_MODEL,
        voice,
        input: text,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        detail = j?.error?.message ?? detail;
      } catch { /* corps non JSON : on garde le statut */ }
      return Response.json({ error: `OpenAI : ${detail}` }, { status: 502 });
    }

    const audio = await res.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur OpenAI';
    return Response.json({ error: msg }, { status: 502 });
  }
}
