import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Cherche récursivement un champ string `uri` ou `videoUri` dans l'objet réponse Veo.
// Veo a plusieurs formes selon la version : generatedVideos[].video.uri,
// generateVideoResponse.generatedSamples[].video.uri, etc.
function findVideoUri(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const seen = new Set<unknown>();
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
    seen.add(cur);
    const rec = cur as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'string' && (k === 'uri' || k === 'videoUri') &&
          v.startsWith('https://generativelanguage.googleapis.com/')) {
        return v;
      }
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

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

    // La forme exacte de la réponse Veo varie selon la version du modèle.
    // On cherche un champ "uri" récursivement sous response/*.
    const done = !!json.done;
    let videoUri: string | null = null;
    if (done) {
      videoUri = findVideoUri(json.response);
    }

    if (done && !videoUri) {
      // On renvoie la réponse brute pour diagnostic côté client.
      console.error('[veo] done sans videoUri, réponse brute :', JSON.stringify(json, null, 2));
      return Response.json(
        {
          done,
          videoUri: null,
          error: 'Veo a terminé mais aucune URI vidéo trouvée. Voir logs serveur pour la structure de la réponse.',
          raw: json,
        },
        { status: 200 },
      );
    }

    return Response.json({ done, videoUri });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur réseau';
    return Response.json({ error: msg }, { status: 502 });
  }
}
