import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'veo-3.0-generate-preview';

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY manquante côté serveur' }, { status: 500 });
  }

  let prompt: string;
  let imageBase64: string | null;
  let imageMime: string | null;
  try {
    const body = await req.json();
    prompt = String(body.prompt ?? '').trim();
    imageBase64 = body.imageBase64 ? String(body.imageBase64) : null;
    imageMime = body.imageMime ? String(body.imageMime) : null;
  } catch {
    return Response.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!prompt && !imageBase64) {
    return Response.json({ error: 'Prompt ou image requis' }, { status: 400 });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const params: Record<string, unknown> = {
      model: MODEL,
      prompt: prompt || 'Animate this image',
    };
    if (imageBase64 && imageMime) {
      params.image = { imageBytes: imageBase64, mimeType: imageMime };
    }
    const operation = await ai.models.generateVideos(params as never);
    return Response.json({ operation });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur Gemini';
    return Response.json({ error: msg }, { status: 502 });
  }
}
