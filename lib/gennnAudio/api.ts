"use client";

// Titres Gennn Audio (audio.gennn.live) : projets de la table `audio_sets`,
// dans la même base Supabase que Gennn Cut et pour le même compte.

import type { SupabaseClient } from '@supabase/supabase-js';

export const GENNN_AUDIO_URL = (process.env.NEXT_PUBLIC_GENNN_AUDIO_URL || 'https://audio.gennn.live').replace(/\/+$/, '');

export interface GennnAudioSet {
  id: string;
  name: string;
  updatedAt: string;
}

/** Lien d'ouverture du projet dans Gennn Audio. */
export function gennnAudioProjectUrl(setId: string): string {
  return `${GENNN_AUDIO_URL}/project/${encodeURIComponent(setId)}`;
}

/** Projets Gennn Audio de l'utilisateur connecté (RLS : propriétaire). */
export async function listGennnAudioSets(supabase: SupabaseClient): Promise<GennnAudioSet[]> {
  const { data, error } = await supabase
    .from('audio_sets')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Lecture des projets Gennn Audio échouée : ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name || 'Sans titre', updatedAt: r.updated_at }));
}

/** Date de dernière sauvegarde de chaque projet demandé (surveillance légère). */
export async function fetchGennnAudioStamps(supabase: SupabaseClient, ids: string[]): Promise<Map<string, GennnAudioSet>> {
  const out = new Map<string, GennnAudioSet>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from('audio_sets').select('id, name, updated_at').in('id', ids);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) out.set(r.id, { id: r.id, name: r.name || 'Sans titre', updatedAt: r.updated_at });
  return out;
}

interface SetDocument {
  tracks?: { slots?: ({ audio?: { sample?: { path?: string } } } | null)[] }[];
}

/**
 * Document complet d'un projet et URL signées de ses enregistrements (bucket
 * privé `audio_samples`) : tout ce qu'il faut au moteur de rendu, qui ne lit
 * rien lui-même.
 */
export async function loadGennnAudioForRender(supabase: SupabaseClient, setId: string): Promise<{
  set: unknown; name: string; updatedAt: string; samples: Record<string, string>;
}> {
  const { data, error } = await supabase
    .from('audio_sets')
    .select('id, name, state, updated_at')
    .eq('id', setId)
    .maybeSingle();
  if (error) throw new Error(`Lecture du projet Gennn Audio échouée : ${error.message}`);
  if (!data) throw new Error('Projet Gennn Audio introuvable (supprimé, ou appartenant à un autre compte)');

  const doc = (data.state ?? {}) as SetDocument;
  const paths = new Set<string>();
  for (const t of doc.tracks ?? []) for (const s of t.slots ?? []) {
    const p = s?.audio?.sample?.path;
    if (p) paths.add(p);
  }
  const samples: Record<string, string> = {};
  if (paths.size > 0) {
    const { data: signed, error: signErr } = await supabase.storage
      .from('audio_samples')
      .createSignedUrls([...paths], 60 * 60);
    if (signErr) throw new Error(`Accès aux enregistrements Gennn Audio refusé : ${signErr.message}`);
    for (const s of signed ?? []) if (s.path && s.signedUrl) samples[s.path] = s.signedUrl;
  }
  return { set: data.state, name: data.name || 'Sans titre', updatedAt: data.updated_at, samples };
}
