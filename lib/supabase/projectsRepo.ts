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


// --- Tolérance aux colonnes manquantes (migrations en retard) ---
// Quand la base n'a pas encore reçu supabase/schema.sql, PostgREST renvoie
// PGRST204 « Could not find the 'x' column ». Plutôt que de perdre toute la
// sauvegarde pour une propriété récente, on retire la colonne incriminée et on
// réessaie ; les colonnes manquantes sont mémorisées pour la session afin de ne
// pas rejouer l'aller-retour à chaque écriture.
type Row = Record<string, unknown>;
const missingColumns = new Map<string, Set<string>>();

// Seules des propriétés d'agrément peuvent être abandonnées. Les colonnes
// structurelles (rattachement aux timelines, géométrie des clips) ne sont
// JAMAIS retirées : les perdre casserait le projet en silence, mieux vaut
// l'erreur de sauvegarde visible qui invite à appliquer supabase/schema.sql.
const OPTIONAL_COLUMNS: Record<string, Set<string>> = {
  fullcrea_tracks: new Set(['solo', 'height_px', 'collapsed', 'kind', 'hidden', 'locked', 'muted']),
  fullcrea_clips: new Set(['speed', 'fade_in_px', 'fade_out_px', 'transition', 'link_id', 'tts', 'volume', 'muted', 'source_duration_px']),
  fullcrea_projects: new Set(['markers']),
};

function missingColumnName(table: string, err: { code?: string; message?: string }): string | null {
  if (err.code !== 'PGRST204') return null;
  const m = /'([^']+)' column/.exec(err.message ?? '');
  const column = m ? m[1] : null;
  if (!column) return null;
  return OPTIONAL_COLUMNS[table]?.has(column) ? column : null;
}

function stripKnownMissing(table: string, rows: Row[]): Row[] {
  const known = missingColumns.get(table);
  if (!known || known.size === 0) return rows;
  return rows.map(row => {
    const copy: Row = {};
    for (const [k, v] of Object.entries(row)) if (!known.has(k)) copy[k] = v;
    return copy;
  });
}

function rememberMissing(table: string, column: string): void {
  const set = missingColumns.get(table) ?? new Set<string>();
  set.add(column);
  missingColumns.set(table, set);
  console.warn(`[fullcrea] Colonne « ${column} » absente de ${table} : sauvegarde sans cette propriété. Appliquez supabase/schema.sql pour la rétablir.`);
}

// Écrit des lignes en retirant une à une les colonnes que la base ne connaît pas.
async function writeTolerant(
  supabase: SupabaseClient,
  table: string,
  rows: Row[],
  mode: 'insert' | 'upsert',
  prefix: string
): Promise<void> {
  let payload = stripKnownMissing(table, rows);
  // Au pire une tentative par colonne de la première ligne
  const maxAttempts = Object.keys(rows[0] ?? {}).length + 1;
  for (let i = 0; i < maxAttempts; i++) {
    const query = supabase.from(table);
    const { error } = mode === 'insert' ? await query.insert(payload) : await query.upsert(payload);
    if (!error) return;
    const column = missingColumnName(table, error);
    if (!column) throw pgError(prefix, error);
    rememberMissing(table, column);
    payload = stripKnownMissing(table, payload);
  }
  throw new Error(`${prefix}: trop de colonnes manquantes dans ${table}`);
}


// Supprime les lignes du projet qui ne font plus partie de l'état sauvegardé.
// Appelée APRÈS une écriture réussie : une sauvegarde interrompue ne peut donc
// jamais laisser le projet amputé dans la base.
async function deleteStale(
  supabase: SupabaseClient,
  table: string,
  projectId: string,
  keyColumn: string,
  keptKeys: (string | number)[],
  prefix: string
): Promise<void> {
  let query = supabase.from(table).delete().eq('project_id', projectId);
  if (keptKeys.length > 0) {
    const list = keptKeys.map(k => typeof k === 'number' ? String(k) : `"${String(k).replace(/"/g, '\\"')}"`).join(',');
    query = query.not(keyColumn, 'in', `(${list})`);
  }
  const { error } = await query;
  if (error) throw pgError(prefix, error);
}

// --- Lecture ---

// Tous les projets visibles par l'utilisateur : les siens et ceux où il est
// co-éditeur (fullcrea_project_members) — le filtrage est assuré par RLS.
export async function fetchAllProjects(supabase: SupabaseClient, userId: string): Promise<Project[]> {
  const { data: projectRows, error } = await supabase
    .from('fullcrea_projects')
    .select('*')
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
        solo?: boolean | null; height_px?: number | null; collapsed?: boolean | null;
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
          solo: t.solo || undefined,
          height: t.height_px ?? undefined,
          collapsed: t.collapsed || undefined,
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
        speed?: number | null; fade_in_px?: number | null; fade_out_px?: number | null;
        transition?: Clip['transition'] | null; link_id?: string | null;
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
        speed: c.speed ?? undefined,
        fadeIn: c.fade_in_px ?? undefined,
        fadeOut: c.fade_out_px ?? undefined,
        transition: c.transition ?? undefined,
        linkId: c.link_id ?? undefined,
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
      ? (p.sequences as { id: string; name: string; markers?: Marker[]; workArea?: Sequence['workArea']; master?: boolean }[])
      : [{ id: MAIN_SEQUENCE_ID, name: 'Timeline 1', markers: Array.isArray(p.markers) ? (p.markers as Marker[]) : [] }];

    const sequences: Sequence[] = storedSequences.map((meta) => ({
      id: meta.id,
      name: meta.name,
      tracks: trackRows.filter((t) => t.sequenceId === meta.id).map((t) => t.track),
      clips: clipRows.filter((c) => c.sequenceId === meta.id).map((c) => c.clip),
      markers: Array.isArray(meta.markers) && meta.markers.length > 0 ? meta.markers : EMPTY_MARKERS,
      workArea: meta.workArea ?? null,
      master: meta.master || undefined,
    }));

    // Récupération : des pistes ou des clips peuvent porter l'id d'une timeline
    // absente des métadonnées (métadonnées écrasées, migration interrompue).
    // Plutôt que de les ignorer en silence — le projet paraît alors vide alors
    // que tout est en base — on reconstitue une timeline pour chacun.
    const knownIds = new Set(sequences.map((x) => x.id));
    const orphanIds = [...new Set([
      ...trackRows.map((t) => t.sequenceId),
      ...clipRows.map((c) => c.sequenceId),
    ])].filter((id) => !knownIds.has(id));
    for (const [i, id] of orphanIds.entries()) {
      const clips = clipRows.filter((c) => c.sequenceId === id).map((c) => c.clip);
      const tracks = trackRows.filter((t) => t.sequenceId === id).map((t) => t.track);
      // Les pistes ont pu rester déclarées sur une autre timeline : sans piste,
      // une timeline n'affiche rien. Les ids de piste étant uniques dans le
      // projet, on emprunte celles que les clips référencent ; à défaut, on en
      // synthétise une du bon type.
      const have = new Set(tracks.map((t) => t.id));
      for (const trackId of new Set(clips.map((c) => c.track))) {
        if (have.has(trackId)) continue;
        const known = trackRows.find((t) => t.track.id === trackId)?.track;
        const clipType = clips.find((c) => c.track === trackId)?.type;
        const type: Track['type'] = known?.type ?? (clipType === 'audio' ? 'audio' : clipType === 'text' ? 'text' : 'video');
        tracks.push(known ? { ...known } : { id: trackId, type, name: type === 'audio' ? 'Audio' : type === 'text' ? 'Texte' : 'Video' });
        have.add(trackId);
      }
      // Une timeline complète a au moins une piste texte, vidéo et audio
      let nextTrackId = Math.max(0, ...trackRows.map((t) => t.track.id), ...tracks.map((t) => t.id)) + 1;
      for (const type of ['text', 'video', 'audio'] as const) {
        if (tracks.some((t) => t.type === type)) continue;
        tracks.push({ id: nextTrackId++, type, name: type === 'text' ? 'Texte' : type === 'video' ? 'Video 1' : 'Audio 1' });
      }
      // Ordre d'affichage : texte, vidéo, audio (comme une timeline neuve)
      const rank = (t: Track) => (t.type === 'text' ? 0 : t.type === 'video' ? 1 : 2);
      tracks.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
      const rescued: Sequence = {
        id,
        name: `Timeline récupérée ${i + 1}`,
        tracks,
        clips,
        markers: EMPTY_MARKERS,
        workArea: null,
      };
      console.warn(`[fullcrea] Timeline « ${id} » absente des métadonnées : ${rescued.clips.length} clip(s) récupéré(s).`);
      sequences.push(rescued);
    }

    let activeId = sequences.some((x) => x.id === p.active_sequence_id)
      ? (p.active_sequence_id as string)
      : sequences[0].id;
    // Si la timeline déclarée active est vide alors qu'une timeline récupérée
    // porte du contenu, on ouvre celle-ci : sinon le projet s'ouvre sur une
    // timeline vide et le montage retrouvé passe inaperçu.
    if (orphanIds.length > 0 && sequences.find((x) => x.id === activeId)?.clips.length === 0) {
      const withContent = sequences.find((x) => orphanIds.includes(x.id) && x.clips.length > 0);
      if (withContent) activeId = withContent.id;
    }
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
      ownerId: p.user_id ?? undefined,
      // Un co-éditeur ne doit pas pouvoir redistribuer l'accès au projet
      editToken: p.user_id === userId ? (p.edit_token ?? null) : null,
      updatedAt: p.updated_at ?? null,
    } satisfies Project;
  });
}

export type SharedRole = 'owner' | 'editor' | 'viewer';

// Rejoint un projet via un jeton de co-édition (compte requis) : inscrit
// l'utilisateur dans fullcrea_project_members. Renvoie null si le jeton est inconnu.
export async function joinProjectByToken(
  supabase: SupabaseClient,
  token: string
): Promise<{ projectId: string; role: SharedRole } | null> {
  const { data, error } = await supabase.rpc('fullcrea_join_project', { p_token: token });
  if (error) throw pgError('Accès au projet partagé refusé', error);
  return (data as { projectId: string; role: SharedRole } | null) ?? null;
}

// --- Écriture (upsert d'un projet entier) ---
// Stratégie : upsert projects/settings, puis delete+insert tracks/assets/clips.
// Simple et robuste pour la taille des données concernées.

export async function upsertProject(
  supabase: SupabaseClient,
  userId: string,
  p: Project
): Promise<void> {
  // Quatre étapes, chacune en parallèle : (1) projet + réglages, (2) pistes,
  // (3) clips + assets (FK vers les pistes pour les clips), (4) nettoyage.
  const projectFields = {
    name: p.name,
    current_view: p.currentView,
    markers: p.markers,
    // Métadonnées des timelines ; leur contenu vit dans tracks/clips (sequence_id)
    sequences: p.sequences.map((seq) => ({
      id: seq.id, name: seq.name, markers: seq.markers, workArea: seq.workArea ?? null, master: !!seq.master,
    })),
    active_sequence_id: p.activeSequenceId,
  };
  // Un co-éditeur ne peut pas passer par l'upsert (la politique INSERT exige
  // user_id = auth.uid()) : il met à jour la ligne du propriétaire.
  const isOwner = !p.ownerId || p.ownerId === userId;
  const writeProject = isOwner
    ? writeTolerant(supabase, 'fullcrea_projects', [{ id: p.id, user_id: userId, ...projectFields }], 'upsert', 'Écriture fullcrea_projects échouée')
    : (async () => {
        const { error } = await supabase.from('fullcrea_projects').update(projectFields).eq('id', p.id);
        if (error) throw pgError('Écriture fullcrea_projects échouée', error);
      })();

  const writeSettings = (async () => {
    const { error: sErr } = await supabase.from('fullcrea_project_settings').upsert({
      project_id: p.id,
      width: p.projectSettings.width,
      height: p.projectSettings.height,
      fps: p.projectSettings.fps,
    });
    if (sErr) throw pgError('Écriture fullcrea_project_settings échouée', sErr);
  })();
  await Promise.all([writeProject, writeSettings]);

  // Écriture NON destructive : on met à jour (upsert) puis on supprime seulement
  // les lignes disparues, une fois l'écriture réussie. L'ancienne stratégie
  // « purge puis insert » perdait toutes les pistes et tous les clips du projet
  // dès que l'insert échouait (colonne manquante, coupure réseau…).
  // Toutes les timelines sont écrites (pas seulement l'active) : les ids de
  // piste sont uniques dans tout le projet, la PK (project_id, track_index) tient.
  const allTracks = p.sequences.flatMap((seq) => seq.tracks.map((t) => ({ t, sequenceId: seq.id })));
  if (allTracks.length > 0) {
    await writeTolerant(supabase, 'fullcrea_tracks',
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
        solo: !!t.solo,
        height_px: t.height ?? null,
        collapsed: !!t.collapsed,
      })),
      'upsert', 'Écriture fullcrea_tracks échouée');
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
  const persistableAssets = p.assets.filter((a) => !a.src.startsWith('blob:'));
  const writeClips = safeClips.length === 0 ? Promise.resolve() : writeTolerant(supabase, 'fullcrea_clips',
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
        speed: c.speed ?? null,
        fade_in_px: c.fadeIn ?? null,
        fade_out_px: c.fadeOut ?? null,
        transition: c.transition ?? null,
        link_id: c.linkId ?? null,
        transform: c.transform ?? null,
        text_content: c.text ?? null,
        font_size: c.fontSize ?? null,
        font_family: c.fontFamily ?? null,
        text_color: c.textColor ?? null,
      })),
      'upsert', 'Écriture fullcrea_clips échouée');

  // Assets : les blob: URLs (URL.createObjectURL) ne survivent pas à un reload,
  // inutiles à persister.
  const writeAssets = (async () => {
    if (persistableAssets.length === 0) return;
    const { error: aErr } = await supabase.from('fullcrea_assets').upsert(
      persistableAssets.map((a) => ({
        id: a.id,
        project_id: p.id,
        name: a.name,
        type: a.type,
        src: a.src,
      }))
    );
    if (aErr) throw pgError('Écriture fullcrea_assets échouée', aErr);
  })();
  await Promise.all([writeClips, writeAssets]);

  // Lignes disparues, supprimées seulement maintenant. Les pistes attendent les
  // clips (FK) ; les assets sont indépendants.
  await Promise.all([
    deleteStale(supabase, 'fullcrea_clips', p.id, 'id', safeClips.map(({ c }) => c.id), 'Nettoyage fullcrea_clips échoué')
      .then(() => deleteStale(supabase, 'fullcrea_tracks', p.id, 'track_index', allTracks.map(({ t }) => t.id), 'Nettoyage fullcrea_tracks échoué')),
    deleteStale(supabase, 'fullcrea_assets', p.id, 'id', persistableAssets.map(a => a.id), 'Nettoyage fullcrea_assets échoué'),
  ]);
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
