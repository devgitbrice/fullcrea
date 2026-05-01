import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Polling via REST direct — plus fiable que de re-sérialiser l'objet Operation
// du SDK (qui perd ses méthodes de classe au passage JSON).
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY manquante côté serveur' }, { status: 500 });
  }

  let operationName: string;
  try {
    const body = await req.json();
    operationName = String(body.operationName ?? '');
  } catch {
    return Response.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!operationName) return Response.json({ error: 'operationName manquant' }, { status: 400 });

  // Sécurité : on n'autorise que des noms d'opération Veo.
  if (!/^models\/[a-z0-9.\-_]+\/operations\/[a-zA-Z0-9._-]+$/.test(operationName)) {
    return Response.json({ error: 'operationName invalide' }, { status: 400 });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      return Response.json({ error: msg }, { status: 502 });
    }

    // Réponse Veo : { name, done, response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } } }
    // ou (selon version) generatedVideos[0].video.uri
    const done = !!json.done;
    let videoUri: string | null = null;
    if (done) {
      const r = json.response ?? {};
      videoUri =
        r?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
        r?.generatedVideos?.[0]?.video?.uri ??
        r?.generated_videos?.[0]?.video?.uri ??
        null;
    }

    return Response.json({ done, videoUri });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur réseau';
    return Response.json({ error: msg }, { status: 502 });
  }
}
