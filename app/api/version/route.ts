import { NextResponse } from "next/server";

// Identifiant unique à chaque nouveau déploiement Vercel.
// En local (pas de build Vercel), on retombe sur l'heure de démarrage du process.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  String(Date.now());

export async function GET() {
  return NextResponse.json(
    { version: BUILD_ID },
    { headers: { "Cache-Control": "no-store" } }
  );
}
