"use client";

import { SupabaseClient } from '@supabase/supabase-js';
import type { Project, Asset, Track, Clip } from '@/components/ProjectContext';
import { STORAGE_BUCKET } from './client';

// --- Lecture ---

export async function fetchAllProjects(supabase: SupabaseClient, userId: string): Promise<Project[]> {
  const { data: projectRows, error } = await supabase
    .from('fullcrea_projects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error || !projectRows || projectRows.length === 0) return [];

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
      .map((t: { track_index: number; type: 'video' | 'audio'; name: string }) => ({
        id: t.track_index,
        type: t.type,
        name: t.name,
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
  });
  if (pErr) throw pErr;

  const { error: sErr } = await supabase.from('fullcrea_project_settings').upsert({
    project_id: p.id,
    width: p.projectSettings.width,
    height: p.projectSettings.height,
    fps: p.projectSettings.fps,
  });
  if (sErr) throw sErr;

  // Clips d'abord (FK vers tracks), puis tracks
  await supabase.from('fullcrea_clips').delete().eq('project_id', p.id);
  await supabase.from('fullcrea_tracks').delete().eq('project_id', p.id);

  if (p.tracks.length > 0) {
    const { error: tErr } = await supabase.from('fullcrea_tracks').insert(
      p.tracks.map((t) => ({
        project_id: p.id,
        track_index: t.id,
        type: t.type,
        name: t.name,
      }))
    );
    if (tErr) throw tErr;
  }

  if (p.clips.length > 0) {
    const { error: cErr } = await supabase.from('fullcrea_clips').insert(
      p.clips.map((c) => ({
        id: c.id,
        project_id: p.id,
        track_index: c.track,
        type: c.type,
        name: c.name,
        src: c.src ?? '',
        start_px: c.start,
        width_px: Math.max(c.width, 0.001),
        transform: c.transform ?? null,
        text_content: c.text ?? null,
        font_size: c.fontSize ?? null,
        font_family: c.fontFamily ?? null,
        text_color: c.textColor ?? null,
      }))
    );
    if (cErr) throw cErr;
  }

  // Assets : on filtre les blob: URLs (créées via URL.createObjectURL),
  // qui ne survivent pas à un reload donc inutiles à persister.
  const persistableAssets = p.assets.filter((a) => !a.src.startsWith('blob:'));
  await supabase.from('fullcrea_assets').delete().eq('project_id', p.id);
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
    if (aErr) throw aErr;
  }
}

export async function deleteProjectRow(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
  await supabase.from('fullcrea_projects').delete().eq('id', projectId);
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
    // On lève l'erreur pour qu'elle remonte à l'UI au lieu de tomber silencieusement
    // sur un blob: URL qui ne sera jamais persisté.
    throw new Error(`Storage upload failed: ${error.message}`);
  }
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { src: data.publicUrl, storagePath: path };
}
