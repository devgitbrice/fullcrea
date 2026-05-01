import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Stream les octets d'une vidéo Veo terminée vers le client.
// La clé API n'est jamais exposée — le serveur fetch lui-même l'URL signée.
export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'GEMINI_API_KEY manquante côté serveur' }, { status: 500 });
  }

  let videoUri: string;
  try {
    const body = await req.json();
    videoUri = String(body.videoUri ?? '');
  } catch {
    return Response.json({ error: 'Body JSON invalide' }, { status: 400 });
  }
  if (!videoUri) return Response.json({ error: 'videoUri manquant' }, { status: 400 });

  // Évite l'open redirect : on n'autorise que les URIs Google.
  if (!videoUri.startsWith('https://generativelanguage.googleapis.com/')) {
    return Response.json({ error: 'URI non autorisé' }, { status: 400 });
  }

  const sep = videoUri.includes('?') ? '&' : '?';
  const signedUrl = `${videoUri}${sep}key=${encodeURIComponent(apiKey)}`;

  try {
    const upstream = await fetch(signedUrl);
    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `Téléchargement Veo échoué (HTTP ${upstream.status})` },
        { status: 502 },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'video/mp4',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur réseau';
    return Response.json({ error: msg }, { status: 502 });
  }
}
