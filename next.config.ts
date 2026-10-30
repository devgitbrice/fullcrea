import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    // Figé au moment du build (donc à chaque déploiement)
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    // Commit déployé, gravé dans la page : comparé à /api/version pour
    // proposer de recharger quand une nouvelle version est en ligne
    NEXT_PUBLIC_BUILD_COMMIT: process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
};

export default nextConfig;
