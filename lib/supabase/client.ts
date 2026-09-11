"use client";

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Retourne un client Supabase si les variables d'env sont définies, sinon null.
 * Le front-end retombe alors sur localStorage.
 */
export function getSupabase(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Nécessaire pour que le lien de réinitialisation de mot de passe (hash
      // #access_token=…&type=recovery) ouvre une session PASSWORD_RECOVERY.
      detectSessionInUrl: true,
    },
  });
  return cached;
}

export interface CurrentUser {
  id: string;
  email: string | null;
}

/**
 * Renvoie l'utilisateur courant (id + email) si une session existe, sinon null.
 * L'AuthGate est responsable d'amener l'utilisateur à se connecter.
 */
export async function getCurrentUser(supabase: SupabaseClient): Promise<CurrentUser | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

/**
 * Renvoie l'user.id si une session existe, sinon null.
 */
export async function ensureSignedIn(supabase: SupabaseClient): Promise<string | null> {
  const user = await getCurrentUser(supabase);
  return user?.id ?? null;
}

export const STORAGE_BUCKET = 'fullcrea-assets';
