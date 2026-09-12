"use client";

import { SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_BUCKET } from './client';
import type { Clip, Marker, ProjectSettings, Sequence, Track } from '@/lib/timeline/types';
import { EMPTY_MARKERS } from '@/lib/timeline/types';

export interface Share {
  id: string;
  title: string;
  /** MP4 rendu (partage figé) ; null pour un partage en direct */
  src: string | null;
  width: number;
  height: number;
  durationSec: number | null;
  /** true : le lien rejoue le projet et suit ses modifications */
  live: boolean;
  /** Timeline partagée (partage en direct) */
  sequenceId: string | null;
  createdAt: string | null;
}

/** Montage lu par le lecteur public d'un partage en direct. */
export interface LiveMontage {
  title: string;
  settings: ProjectSettings;
  sequences: Sequence[];
  /** Timeline à jouer (celle du partage, sinon la première) */
  sequenceId: string;
  /** Horodatage de la dernière sauvegarde : sert à détecter les changements */
  updatedAt: string | null;
}

export interface SharePayload {
  share: Share;
  montage: LiveMontage | null;
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
    live: false,
  });
  if (error) {
    // La ligne n'a pas pu être créée : on ne laisse pas le fichier orphelin
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => undefined);
    throw shareError('Création du partage échouée', error);
  }

  return { id, title, src, width, height, durationSec, live: false, sequenceId: null, createdAt: null };
}

interface CreateLiveShareInput {
  projectId: string;
  sequenceId: string;
  title: string;
  width: number;
  height: number;
  durationSec: number;
}

/**
 * Crée un partage EN DIRECT : aucun rendu, le lien rejoue la timeline du
 * projet et reflète les modifications au fil des sauvegardes.
 */
export async function createLiveShare(
  supabase: SupabaseClient,
  userId: string,
  { projectId, sequenceId, title, width, height, durationSec }: CreateLiveShareInput,
): Promise<Share> {
  const id = newShareId();
  const { error } = await supabase.from(SHARES_TABLE).insert({
    id,
    user_id: userId,
    project_id: projectId,
    sequence_id: sequenceId,
    title,
    src: null,
    live: true,
    width,
    height,
    duration_sec: durationSec,
  });
  if (error) throw shareError('Création du partage échouée', error);
  return { id, title, src: null, width, height, durationSec, live: true, sequenceId, createdAt: null };
}

// --- Lecture publique ---

interface TrackRow {
  sequence_id: string | null; track_index: number;
  type: Track['type']; name: string; kind?: Track['kind'] | null;
  muted?: boolean | null; hidden?: boolean | null; locked?: boolean | null;
  solo?: boolean | null; height_px?: number | null; collapsed?: boolean | null;
}

interface ClipRow {
  sequence_id: string | null; id: string; name: string; type: Clip['type'];
  track_index: number; start_px: number; width_px: number; src: string;
  offset_px?: number | null; source_duration_px?: number | null;
  volume?: number | null; muted?: boolean | null;
  tts?: Clip['tts'] | null; sequence_ref?: string | null;
  speed?: number | null; fade_in_px?: number | null; fade_out_px?: number | null;
  transition?: Clip['transition'] | null; link_id?: string | null;
  transform?: Clip['transform'] | null;
  text_content?: string | null; font_size?: number | null;
  font_family?: string | null; text_color?: string | null;
}

const MAIN_SEQUENCE_ID = 'seq_main';

function toTrack(t: TrackRow): Track {
  return {
    id: t.track_index,
    type: t.type,
    name: t.name,
    muted: t.muted || undefined,
    hidden: t.hidden || undefined,
    locked: t.locked || undefined,
    kind: t.kind ?? undefined,
    solo: t.solo || undefined,
    height: t.height_px ?? undefined,
    collapsed: t.collapsed || undefined,
  };
}

function toClip(c: ClipRow): Clip {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    track: c.track_index,
    start: c.start_px,
    width: c.width_px,
    src: c.src,
    offset: c.offset_px || undefined,
    sourceDuration: c.source_duration_px ?? undefined,
    volume: c.volume ?? undefined,
    muted: c.muted || undefined,
    speed: c.speed ?? undefined,
    fadeIn: c.fade_in_px ?? undefined,
    fadeOut: c.fade_out_px ?? undefined,
    transition: c.transition ?? undefined,
    linkId: c.link_id ?? undefined,
    tts: c.tts ?? undefined,
    sequenceRef: c.sequence_ref ?? undefined,
    transform: c.transform ?? undefined,
    text: c.text_content ?? undefined,
    fontSize: c.font_size ?? undefined,
    fontFamily: c.font_family ?? undefined,
    textColor: c.text_color ?? undefined,
  };
}

/**
 * Lit un partage et, s'il est en direct, le montage courant du projet.
 * Passe par une fonction SECURITY DEFINER : seules les données du partage
 * demandé sortent, le projet reste privé.
 */
export async function fetchSharePayload(supabase: SupabaseClient, id: string): Promise<SharePayload | null> {
  const { data, error } = await supabase.rpc('fullcrea_share_payload', { share_id: id });
  if (error) throw shareError('Lecture du partage échouée', error);
  if (!data || !data.share) return null;

  const raw = data.share as {
    id: string; title: string; live: boolean; src: string | null;
    width: number; height: number; durationSec: number | null; sequenceId: string | null;
  };
  const share: Share = {
    id: raw.id,
    title: raw.title,
    src: raw.src,
    width: raw.width,
    height: raw.height,
    durationSec: raw.durationSec ?? null,
    live: !!raw.live,
    sequenceId: raw.sequenceId ?? null,
    createdAt: null,
  };

  const project = data.project as {
    name: string;
    sequences: { id: string; name: string; markers?: Marker[]; workArea?: Sequence['workArea']; master?: boolean }[] | null;
    activeSequenceId: string | null;
    settings: ProjectSettings;
    tracks: TrackRow[];
    clips: ClipRow[];
  } | null;

  if (!share.live || !project) return { share, montage: null };

  const metas = Array.isArray(project.sequences) && project.sequences.length > 0
    ? project.sequences
    : [{ id: MAIN_SEQUENCE_ID, name: 'Timeline 1', markers: [] as Marker[], workArea: null, master: false }];

  const sequences: Sequence[] = metas.map((meta) => ({
    id: meta.id,
    name: meta.name,
    tracks: (project.tracks ?? [])
      .filter((t) => (t.sequence_id ?? MAIN_SEQUENCE_ID) === meta.id)
      .map(toTrack),
    clips: (project.clips ?? [])
      .filter((c) => (c.sequence_id ?? MAIN_SEQUENCE_ID) === meta.id)
      .map(toClip),
    markers: Array.isArray(meta.markers) && meta.markers.length > 0 ? meta.markers : (EMPTY_MARKERS as Marker[]),
    workArea: meta.workArea ?? null,
    master: meta.master || undefined,
  }));

  const sequenceId = sequences.some((s) => s.id === share.sequenceId)
    ? share.sequenceId!
    : (sequences.find((s) => s.id === project.activeSequenceId)?.id ?? sequences[0].id);

  return {
    share,
    montage: {
      title: project.name || share.title,
      settings: project.settings,
      sequences,
      sequenceId,
      updatedAt: (data.updatedAt as string | null) ?? null,
    },
  };
}
