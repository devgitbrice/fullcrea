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
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/**
 * Garantit qu'un user est connecté (anonyme par défaut).
 * Renvoie l'user.id ou null si la connexion a échoué.
 */
export async function ensureSignedIn(supabase: SupabaseClient): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    console.warn('[fullcrea] Auth anonyme indisponible', error?.message);
    return null;
  }
  return data.user.id;
}

export const STORAGE_BUCKET = 'fullcrea-assets';
