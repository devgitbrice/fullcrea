"use client";

import { SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_BUCKET } from './client';

export interface Share {
  id: string;
  title: string;
  src: string;
  width: number;
  height: number;
  durationSec: number | null;
  createdAt: string | null;
}

const SHARES_TABLE = 'fullcrea_shares';

function shareError(prefix: string, err: { message?: string; details?: string; hint?: string; code?: string }): Error {
  const parts = [err.message, err.details, err.hint, err.code ? `(code ${err.code})` : null].filter(Boolean);
  return new Error(`${prefix}: ${parts.join(' — ') || 'erreur inconnue'}`);
}

/** Identifiant de partage non devinable (l'URL est le seul secret). */
export function newShareId(): string {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  return uuid.replace(/-/g, '');
}

interface CreateShareInput {
  projectId: string;
  title: string;
  blob: Blob;
  width: number;
  height: number;
  durationSec: number;
}

/**
 * Dépose la vidéo rendue dans le bucket public et crée la ligne de partage.
 * Renvoie le partage, dont `src` est l'URL publique du MP4.
 */
export async function createShare(
  supabase: SupabaseClient,
  userId: string,
  { projectId, title, blob, width, height, durationSec }: CreateShareInput,
): Promise<Share> {
  const id = newShareId();
  const storagePath = `${userId}/shares/${id}.mp4`;

  const { error: upErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, blob, { upsert: false, contentType: 'video/mp4' });
  if (upErr) throw new Error(`Envoi de la vidéo échoué : ${upErr.message}`);

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  const src = data.publicUrl;

  const { error } = await supabase.from(SHARES_TABLE).insert({
    id,
    user_id: userId,
    project_id: projectId,
    title,
    src,
    storage_path: storagePath,
    width,
    height,
    duration_sec: durationSec,
  });
  if (error) {
    // La ligne n'a pas pu être créée : on ne laisse pas le fichier orphelin
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => undefined);
    throw shareError('Création du partage échouée', error);
  }

  return { id, title, src, width, height, durationSec, createdAt: null };
}

/** Lit un partage par son id (lecture publique : aucune session requise). */
export async function fetchShare(supabase: SupabaseClient, id: string): Promise<Share | null> {
  const { data, error } = await supabase
    .from(SHARES_TABLE)
    .select('id, title, src, width, height, duration_sec, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw shareError('Lecture du partage échouée', error);
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    src: data.src,
    width: data.width,
    height: data.height,
    durationSec: data.duration_sec ?? null,
    createdAt: data.created_at ?? null,
  };
}
