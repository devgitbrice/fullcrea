import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY manquante côté serveur' }, { status: 500 });
  }

  let operation: unknown;
  try {
    const body = await req.json();
    operation = body.operation;
  } catch {
    return Response.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!operation) return Response.json({ error: 'Operation manquante' }, { status: 400 });

  const ai = new GoogleGenAI({ apiKey });

  try {
    const updated = await ai.operations.getVideosOperation({ operation: operation as never });
    return Response.json({ operation: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur Gemini';
    return Response.json({ error: msg }, { status: 502 });
  }
}
