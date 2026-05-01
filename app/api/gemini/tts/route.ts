import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { pcmToWav } from '@/lib/gemini/wav';
import { DEFAULT_VOICE } from '@/lib/gemini/voices';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'gemini-2.5-flash-preview-tts';

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY manquante côté serveur' }, { status: 500 });
  }

  let text: string;
  let voice: string;
  try {
    const body = await req.json();
    text = String(body.text ?? '').trim();
    voice = String(body.voice ?? DEFAULT_VOICE);
  } catch {
    return Response.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!text) return Response.json({ error: 'Texte vide' }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) {
      return Response.json({ error: 'Aucun audio renvoyé par Gemini' }, { status: 502 });
    }

    const pcm = Buffer.from(data, 'base64');
    const wav = pcmToWav(new Uint8Array(pcm), 24000);
    const ab = new ArrayBuffer(wav.byteLength);
    new Uint8Array(ab).set(wav);

    return new Response(new Blob([ab], { type: 'audio/wav' }), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur Gemini';
    return Response.json({ error: msg }, { status: 502 });
  }
}
