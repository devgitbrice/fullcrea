import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = 'veo-3.1-generate-preview';

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
    // On extrait juste le `name` (ex: "models/veo-3.1.../operations/abc").
    // Passer l'objet complet entre client et serveur casse l'instance de classe
    // côté SDK (t._fromAPIResponse is not a function). Le polling se fera via REST.
    const opName = (operation as unknown as { name?: string }).name
      ?? (operation as unknown as { operation?: { name?: string } }).operation?.name;
    if (!opName) {
      return Response.json({ error: 'Réponse Veo sans nom d\'opération' }, { status: 502 });
    }
    return Response.json({ operationName: opName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur Gemini';
    return Response.json({ error: msg }, { status: 502 });
  }
}
