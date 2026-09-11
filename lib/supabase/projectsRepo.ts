"use client";

import { SupabaseClient } from '@supabase/supabase-js';
import type { Project, Asset, Track, Clip, Marker } from '@/lib/timeline/types';
import { EMPTY_MARKERS } from '@/lib/timeline/types';
import { STORAGE_BUCKET } from './client';

// Supabase renvoie des PostgrestError qui ne sont PAS des Error.
// On les transforme pour avoir un message lisible côté UI.
function pgError(prefix: string, err: { message?: string; details?: string; hint?: string; code?: string }): Error {
  const parts = [err.message, err.details, err.hint, err.code ? `(code ${err.code})` : null].filter(Boolean);
  return new Error(`${prefix}: ${parts.join(' — ') || 'erreur inconnue'}`);
}

// --- Lecture ---

export async function fetchAllProjects(supabase: SupabaseClient, userId: string): Promise<Project[]> {
  const { data: projectRows, error } = await supabase
    .from('fullcrea_projects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) throw pgError('Lecture fullcrea_projects échouée', error);
  if (!projectRows || projectRows.length === 0) return [];

  const ids = projectRows.map((p) => p.id);

  const [settingsRes, tracksRes, assetsRes, clipsRes] = await Promise.all([
    supabase.from('fullcrea_project_settings').select('*').in('project_id', ids),
    supabase.from('fullcrea_tracks').select('*').in('project_id', ids),
    supabase.from('fullcrea_assets').select('*').in('project_id', ids),
    supabase.from('fullcrea_clips').select('*').in('project_id', ids),
  ]);

  return projectRows.map((p) => {
    const s = (settingsRes.data ?? []).find((x: { project_id: string }) => x.project_id === p.id);
    const tracks: Track[] = (tracksRes.data ?? [])
      .filter((t: { project_id: string }) => t.project_id === p.id)
      .sort((a: { track_index: number }, b: { track_index: number }) => a.track_index - b.track_index)
      .map((t: {
        track_index: number; type: 'video' | 'audio' | 'text'; name: string;
        muted?: boolean | null; hidden?: boolean | null; locked?: boolean | null;
      }) => ({
        id: t.track_index,
        type: t.type,
        name: t.name,
        muted: t.muted || undefined,
        hidden: t.hidden || undefined,
        locked: t.locked || undefined,
      }));
    const assets: Asset[] = (assetsRes.data ?? [])
      .filter((a: { project_id: string }) => a.project_id === p.id)
      .map((a: { id: string; name: string; type: 'video' | 'audio' | 'image'; src: string }) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        src: a.src,
      }));
    const clips: Clip[] = (clipsRes.data ?? [])
      .filter((c: { project_id: string }) => c.project_id === p.id)
      .map((c: {
        id: string; name: string;
        type: 'video' | 'audio' | 'image' | 'text';
        track_index: number; start_px: number; width_px: number; src: string;
        offset_px?: number | null; source_duration_px?: number | null;
        volume?: number | null; muted?: boolean | null;
        transform: Clip['transform'] | null;
        text_content: string | null; font_size: number | null;
        font_family: string | null; text_color: string | null;
      }) => ({
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
        transform: c.transform ?? undefined,
        text: c.text_content ?? undefined,
        fontSize: c.font_size ?? undefined,
        fontFamily: c.font_family ?? undefined,
        textColor: c.text_color ?? undefined,
      }));

    return {
      id: p.id,
      name: p.name,
      currentView: p.current_view,
      projectSettings: s
        ? { width: s.width, height: s.height, fps: s.fps }
        : { width: 1920, height: 1080, fps: 30 },
      tracks,
      assets,
      clips,
      markers: Array.isArray(p.markers) ? (p.markers as Marker[]) : EMPTY_MARKERS,
    } satisfies Project;
  });
}

// --- Écriture (upsert d'un projet entier) ---
// Stratégie : upsert projects/settings, puis delete+insert tracks/assets/clips.
// Simple et robuste pour la taille des données concernées.

export async function upsertProject(
  supabase: SupabaseClient,
  userId: string,
  p: Project
): Promise<void> {
  const { error: pErr } = await supabase.from('fullcrea_projects').upsert({
    id: p.id,
    user_id: userId,
    name: p.name,
    current_view: p.currentView,
    markers: p.markers,
  });
  if (pErr) throw pgError('Écriture fullcrea_projects échouée', pErr);

  const { error: sErr } = await supabase.from('fullcrea_project_settings').upsert({
    project_id: p.id,
    width: p.projectSettings.width,
    height: p.projectSettings.height,
    fps: p.projectSettings.fps,
  });
  if (sErr) throw pgError('Écriture fullcrea_project_settings échouée', sErr);

  // Clips d'abord (FK vers tracks), puis tracks
  const { error: cDelErr } = await supabase.from('fullcrea_clips').delete().eq('project_id', p.id);
  if (cDelErr) throw pgError('Purge fullcrea_clips échouée', cDelErr);
  const { error: tDelErr } = await supabase.from('fullcrea_tracks').delete().eq('project_id', p.id);
  if (tDelErr) throw pgError('Purge fullcrea_tracks échouée', tDelErr);

  if (p.tracks.length > 0) {
    const { error: tErr } = await supabase.from('fullcrea_tracks').insert(
      p.tracks.map((t) => ({
        project_id: p.id,
        track_index: t.id,
        type: t.type,
        name: t.name,
        muted: !!t.muted,
        hidden: !!t.hidden,
        locked: !!t.locked,
      }))
    );
    if (tErr) throw pgError('Écriture fullcrea_tracks échouée', tErr);
  }

  // Garde anti-orphelins : la FK (project_id, track_index) refuserait un clip
  // dont la piste n'existe plus (les clips texte sont rapatriés sur la piste
  // texte par ensureTextTrack, jamais orphelins).
  const trackIds = new Set(p.tracks.map((t) => t.id));
  const safeClips = p.clips.filter((c) => {
    if (trackIds.has(c.track)) return true;
    console.warn(`[fullcrea] Clip ${c.id} ignoré à la sauvegarde : piste ${c.track} inexistante`);
    return false;
  });
  if (safeClips.length > 0) {
    const { error: cErr } = await supabase.from('fullcrea_clips').insert(
      safeClips.map((c) => ({
        id: c.id,
        project_id: p.id,
        track_index: c.track,
        type: c.type,
        name: c.name,
        src: c.src ?? '',
        start_px: c.start,
        width_px: Math.max(c.width, 0.001),
        offset_px: Math.max(0, c.offset ?? 0),
        source_duration_px: c.sourceDuration ?? null,
        volume: c.volume ?? null,
        muted: !!c.muted,
        transform: c.transform ?? null,
        text_content: c.text ?? null,
        font_size: c.fontSize ?? null,
        font_family: c.fontFamily ?? null,
        text_color: c.textColor ?? null,
      }))
    );
    if (cErr) throw pgError('Écriture fullcrea_clips échouée', cErr);
  }

  // Assets : on filtre les blob: URLs (créées via URL.createObjectURL),
  // qui ne survivent pas à un reload donc inutiles à persister.
  const persistableAssets = p.assets.filter((a) => !a.src.startsWith('blob:'));
  const { error: aDelErr } = await supabase.from('fullcrea_assets').delete().eq('project_id', p.id);
  if (aDelErr) throw pgError('Purge fullcrea_assets échouée', aDelErr);
  if (persistableAssets.length > 0) {
    const { error: aErr } = await supabase.from('fullcrea_assets').insert(
      persistableAssets.map((a) => ({
        id: a.id,
        project_id: p.id,
        name: a.name,
        type: a.type,
        src: a.src,
      }))
    );
    if (aErr) throw pgError('Écriture fullcrea_assets échouée', aErr);
  }
}

export async function deleteProjectRow(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
  const { error } = await supabase.from('fullcrea_projects').delete().eq('id', projectId);
  if (error) throw pgError('Suppression fullcrea_projects échouée', error);
}

// --- Storage : upload d'un fichier importé ---

export async function uploadAsset(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  file: File
): Promise<{ src: string; storagePath: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${userId}/${projectId}/${Date.now()}_${safeName}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  // Vérifie que l'URL publique fonctionne. Si le bucket n'est pas marqué Public,
  // l'upload réussit mais l'URL retourne 400/404 → le fichier serait inutilisable
  // après un reload. On échoue ici pour le détecter.
  try {
    const probe = await fetch(data.publicUrl, { method: 'HEAD' });
    if (!probe.ok) {
      throw new Error(
        `Le fichier a été uploadé mais l'URL publique renvoie HTTP ${probe.status}. ` +
        `Vérifie que le bucket 'fullcrea-assets' est marqué Public dans Supabase → Storage.`
      );
    }
  } catch (probeErr) {
    if (probeErr instanceof TypeError) {
      // Erreur réseau (CORS, offline) — on laisse passer plutôt que de bloquer
      console.warn('[fullcrea] HEAD probe a échoué (réseau)', probeErr);
    } else {
      throw probeErr;
    }
  }

  return { src: data.publicUrl, storagePath: path };
}
