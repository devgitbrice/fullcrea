import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'gemini-3.1-flash-image-preview';

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY manquante côté serveur' }, { status: 500 });
  }

  let prompt: string;
  try {
    const body = await req.json();
    prompt = String(body.prompt ?? '').trim();
  } catch {
    return Response.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!prompt) return Response.json({ error: 'Prompt vide' }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      return Response.json({ error: 'Aucune image renvoyée par Gemini' }, { status: 502 });
    }

    const mime = imagePart.inlineData.mimeType ?? 'image/png';
    const bytes = Buffer.from(imagePart.inlineData.data, 'base64');

    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur Gemini';
    return Response.json({ error: msg }, { status: 502 });
  }
}
