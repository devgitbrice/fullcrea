"use client";

import { SupabaseClient } from '@supabase/supabase-js';
import type { Project, Asset, Track, Clip, Marker, Sequence } from '@/lib/timeline/types';
import { EMPTY_MARKERS } from '@/lib/timeline/types';

// Les pistes et clips portent l'id de leur timeline ; les lignes écrites avant
// l'introduction des timelines multiples appartiennent à la timeline principale.
const MAIN_SEQUENCE_ID = 'seq_main';
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
    const trackRows = (tracksRes.data ?? [])
      .filter((t: { project_id: string }) => t.project_id === p.id)
      .sort((a: { track_index: number }, b: { track_index: number }) => a.track_index - b.track_index)
      .map((t: {
        track_index: number; type: 'video' | 'audio' | 'text'; name: string; kind?: Track['kind'] | null;
        muted?: boolean | null; hidden?: boolean | null; locked?: boolean | null; sequence_id?: string | null;
      }) => ({
        sequenceId: t.sequence_id ?? MAIN_SEQUENCE_ID,
        track: {
          id: t.track_index,
          type: t.type,
          name: t.name,
          muted: t.muted || undefined,
          hidden: t.hidden || undefined,
          locked: t.locked || undefined,
          kind: t.kind ?? undefined,
        } as Track,
      }));
    const assets: Asset[] = (assetsRes.data ?? [])
      .filter((a: { project_id: string }) => a.project_id === p.id)
      .map((a: { id: string; name: string; type: 'video' | 'audio' | 'image'; src: string }) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        src: a.src,
      }));
    const clipRows = (clipsRes.data ?? [])
      .filter((c: { project_id: string }) => c.project_id === p.id)
      .map((c: {
        id: string; name: string;
        type: Clip['type'];
        sequence_id?: string | null; sequence_ref?: string | null;
        track_index: number; start_px: number; width_px: number; src: string;
        offset_px?: number | null; source_duration_px?: number | null;
        volume?: number | null; muted?: boolean | null;
        tts?: Clip['tts'] | null;
        transform: Clip['transform'] | null;
        text_content: string | null; font_size: number | null;
        font_family: string | null; text_color: string | null;
      }) => ({
        sequenceId: c.sequence_id ?? MAIN_SEQUENCE_ID,
        clip: {
        id: c.id,
        name: c.name,
        type: c.type,
        sequenceRef: c.sequence_ref ?? undefined,
        track: c.track_index,
        start: c.start_px,
        width: c.width_px,
        src: c.src,
        offset: c.offset_px || undefined,
        sourceDuration: c.source_duration_px ?? undefined,
        tts: c.tts ?? undefined,
        volume: c.volume ?? undefined,
        muted: c.muted || undefined,
        transform: c.transform ?? undefined,
        text: c.text_content ?? undefined,
        fontSize: c.font_size ?? undefined,
        fontFamily: c.font_family ?? undefined,
        textColor: c.text_color ?? undefined,
        } as Clip,
      }));

    // Métadonnées des timelines : colonne `sequences` (id, name, markers).
    // Projet antérieur : une seule timeline, celle qui porte tout le contenu.
    const storedSequences = Array.isArray(p.sequences) && p.sequences.length > 0
      ? (p.sequences as { id: string; name: string; markers?: Marker[] }[])
      : [{ id: MAIN_SEQUENCE_ID, name: 'Timeline 1', markers: Array.isArray(p.markers) ? (p.markers as Marker[]) : [] }];

    const sequences: Sequence[] = storedSequences.map((meta) => ({
      id: meta.id,
      name: meta.name,
      tracks: trackRows.filter((t) => t.sequenceId === meta.id).map((t) => t.track),
      clips: clipRows.filter((c) => c.sequenceId === meta.id).map((c) => c.clip),
      markers: Array.isArray(meta.markers) && meta.markers.length > 0 ? meta.markers : EMPTY_MARKERS,
    }));

    const activeId = sequences.some((x) => x.id === p.active_sequence_id)
      ? (p.active_sequence_id as string)
      : sequences[0].id;
    const active = sequences.find((x) => x.id === activeId)!;

    return {
      id: p.id,
      name: p.name,
      currentView: p.current_view,
      projectSettings: s
        ? { width: s.width, height: s.height, fps: s.fps }
        : { width: 1920, height: 1080, fps: 30 },
      sequences,
      activeSequenceId: activeId,
      tracks: active.tracks,
      clips: active.clips,
      markers: active.markers,
      assets,
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
    // Métadonnées des timelines ; leur contenu vit dans tracks/clips (sequence_id)
    sequences: p.sequences.map((seq) => ({ id: seq.id, name: seq.name, markers: seq.markers })),
    active_sequence_id: p.activeSequenceId,
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

  // Toutes les timelines sont écrites (pas seulement l'active) : les ids de
  // piste sont uniques dans tout le projet, la PK (project_id, track_index) tient.
  const allTracks = p.sequences.flatMap((seq) => seq.tracks.map((t) => ({ t, sequenceId: seq.id })));
  if (allTracks.length > 0) {
    const { error: tErr } = await supabase.from('fullcrea_tracks').insert(
      allTracks.map(({ t, sequenceId }) => ({
        project_id: p.id,
        sequence_id: sequenceId,
        track_index: t.id,
        type: t.type,
        name: t.name,
        muted: !!t.muted,
        hidden: !!t.hidden,
        locked: !!t.locked,
        kind: t.kind ?? null,
      }))
    );
    if (tErr) throw pgError('Écriture fullcrea_tracks échouée', tErr);
  }

  // Garde anti-orphelins : la FK (project_id, track_index) refuserait un clip
  // dont la piste n'existe plus (les clips texte sont rapatriés sur la piste
  // texte par ensureTextTrack, jamais orphelins).
  const trackIds = new Set(allTracks.map(({ t }) => t.id));
  const safeClips = p.sequences
    .flatMap((seq) => seq.clips.map((c) => ({ c, sequenceId: seq.id })))
    .filter(({ c }) => {
      if (trackIds.has(c.track)) return true;
      console.warn(`[fullcrea] Clip ${c.id} ignoré à la sauvegarde : piste ${c.track} inexistante`);
      return false;
    });
  if (safeClips.length > 0) {
    const { error: cErr } = await supabase.from('fullcrea_clips').insert(
      safeClips.map(({ c, sequenceId }) => ({
        id: c.id,
        project_id: p.id,
        sequence_id: sequenceId,
        sequence_ref: c.sequenceRef ?? null,
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
        tts: c.tts ?? null,
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
