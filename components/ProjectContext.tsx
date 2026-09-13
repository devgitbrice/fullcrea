"use client";

import { shouldIgnoreShortcut } from '@/lib/keyboard';
import { createContext, useContext, useState, useEffect, useLayoutEffect, useRef, ReactNode, Dispatch, SetStateAction, useCallback, useMemo, MutableRefObject } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, getCurrentUser } from '@/lib/supabase/client';
import { fetchAllProjects, upsertProject, deleteProjectRow, uploadAsset, joinProjectByToken } from '@/lib/supabase/projectsRepo';
import { useBeforeUnload } from '@/lib/hooks/useBeforeUnload';
import type { Clip, Track, Marker, ImageTransform, Asset, ViewMode, ProjectSettings, Project, TrackKind, Sequence } from '@/lib/timeline/types';
import { EMPTY_MARKERS, PX_PER_SEC_BASE, MIN_CLIP_WIDTH_PX } from '@/lib/timeline/types';
import {
  newId, clipEnd, splitClip, computeRipple, findFreeStart, findFreeGroupDelta,
  flattenClips, sequenceDurationPx, wouldCreateCycle,
} from '@/lib/timeline/clipOps';

// --- TYPES DU MODÈLE ---
// Définis dans lib/timeline/types.ts (helpers purs testables sans bundler) et
// ré-exportés ici : les imports existants ne changent pas.
export type { Clip, Track, Marker, ImageTransform, Asset, ViewMode, ProjectSettings, Project, TrackKind, Sequence } from '@/lib/timeline/types';
export { PX_PER_SEC_BASE, MIN_CLIP_WIDTH_PX, EMPTY_MARKERS } from '@/lib/timeline/types';

export const defaultImageTransform: ImageTransform = {
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scaleX: 1,
  scaleY: 1,
  positionX: 0,
  positionY: 0,
};

export type ToolMode = 'select' | 'cut' | 'text';

export type AccessRole = 'owner' | 'editor' | 'viewer';

export interface ProjectProviderProps {
  children: ReactNode;
  // Projet à ouvrir une fois l'hydratation terminée (route /editor/[id])
  initialProjectId?: string;
  // Jeton de co-édition (?t=…) : inscrit l'utilisateur connecté comme co-éditeur
  editToken?: string;
  // Aucune écriture (ni sauvegarde, ni upload) : aperçus
  readOnly?: boolean;
  // Projet déjà chargé : pas d'hydratation réseau (aperçu dans la liste des projets)
  preloadedProject?: Project;
}

type TimeSubscriber = (time: number) => void;

export type PersistenceMode = 'cloud' | 'local' | 'local-fallback';

// idle = avant l'hydratation
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface HistorySnapshot {
  clips: Clip[];
  tracks: Track[];
  markers: Marker[];
}

// Jeton rendu par les actions discrètes : identifie l'entrée d'historique
// qu'elles ont empilée. `undoIfTop` n'annule que si elle est encore au sommet
// (rien n'a été fait depuis). Opaque pour les appelants.
export interface HistoryToken {
  // Portée « projet#timeline » : chaque timeline a sa propre pile
  readonly scope: string;
  readonly snapshot: HistorySnapshot;
}

export type SelectMode = 'replace' | 'toggle' | 'add' | 'range';

interface ProjectHistory {
  undo: HistorySnapshot[];
  redo: HistorySnapshot[];
}

interface ProjectContextType {
  // Multi-projets
  projects: Project[];
  currentProjectId: string;
  currentProject: Project;
  createProject: (name?: string) => string;
  selectProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;

  // Persistance
  isHydrated: boolean;
  isPersistenceCloud: boolean;
  persistenceMode: PersistenceMode;
  persistenceError: string | null;
  uploadAssetFile: (file: File) => Promise<Asset>;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  userEmail: string | null;
  userId: string | null;
  // Accès au projet courant
  readOnly: boolean;
  accessRole: AccessRole;
  // initialProjectId demandé mais introuvable une fois hydraté
  projectNotFound: boolean;

  // Historique (undo/redo). Undo/redo ne restaurent pas la sélection (dérivée
  // des clips : un clip disparu en sort automatiquement).
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Geste explicite (drag/trim) : une seule entrée d'historique du début à la fin
  beginHistoryGesture: () => void;
  endHistoryGesture: () => void;
  // Abandonne le geste en cours : restaure l'état d'avant sans entrée fantôme
  cancelHistoryGesture: () => void;
  // undo() seulement si l'entrée du jeton est encore au sommet de la pile
  undoIfTop: (token: HistoryToken) => boolean;

  // Lecture
  isPlaying: boolean;
  togglePlay: () => void;
  currentTime: number;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  currentTimeRef: MutableRefObject<number>;
  subscribeToTime: (callback: TimeSubscriber) => () => void;

  // Données du projet courant (proxy)
  clips: Clip[];
  setClips: Dispatch<SetStateAction<Clip[]>>;
  // Mise à jour hors historique (ex. durée réelle d'un clip après probe async)
  setClipsWithoutHistory: Dispatch<SetStateAction<Clip[]>>;
  // Lecture synchrone du dernier état commité (handlers d'événements natifs)
  getClips: () => Clip[];
  getTracks: () => Track[];
  // Actions plurielles : chacune = exactement une entrée d'historique
  insertClip: (clip: Omit<Clip, 'track'>, trackType: 'video' | 'audio') => { id: string; track: number };
  // Insertion sur une piste précise (pistes spéciales) : place libre, sélection
  insertClipOnTrack: (clip: Omit<Clip, 'track'>, trackId: number) => string;
  // Mise à jour ponctuelle (historisée) d'un clip : nouveau média, texte TTS…
  updateClipFields: (id: string, patch: Partial<Clip>) => void;
  deleteClips: (ids: string[]) => HistoryToken | null;
  deleteClip: (id: string) => HistoryToken | null;
  duplicateClips: (ids: string[]) => string[];
  duplicateClip: (id: string) => string[];
  rippleDeleteClips: (ids: string[]) => HistoryToken | null;
  splitClipsAt: (ids: string[], timePx: number) => string[];
  updateClips: (ids: string[], patch: Partial<Pick<Clip, 'volume' | 'muted'>>, discrete?: boolean) => void;
  pasteClips: (source: Clip[], atPx: number) => string[];
  projectDurationPx: number;
  tracks: Track[];
  addTrack: (type: 'video' | 'audio') => number;
  ensureTrack: (type: 'video' | 'audio', opts?: { unlocked?: boolean }) => number;
  updateTrack: (id: number, patch: Partial<Pick<Track, 'name' | 'muted' | 'hidden' | 'locked'>>) => void;
  deleteTrack: (id: number) => HistoryToken | null;
  textTrackId: number;
  assets: Asset[];
  setAssets: Dispatch<SetStateAction<Asset[]>>;
  setProjectSettings: (settings: ProjectSettings) => void;

  // Timelines du projet (séquences). La timeline active fournit clips/tracks/markers.
  sequences: Sequence[];
  activeSequenceId: string;
  createSequence: (name?: string) => string;
  selectSequence: (id: string) => void;
  renameSequence: (id: string, name: string) => void;
  /** Déplace une timeline dans l'ordre du projet (vue mindmap) */
  moveSequence: (id: string, toIndex: number) => void;
  /**
   * Crée (ou met à jour) la timeline d'assemblage qui enchaîne toutes les
   * autres dans l'ordre, et renvoie son id.
   */
  buildMasterSequence: () => string;
  /** Vide la file de sauvegarde immédiatement (avant d'ouvrir un lien de partage). */
  saveNow: () => Promise<void>;
  deleteSequence: (id: string) => void;
  // Insère une autre timeline comme un clip dans la timeline active
  insertSequenceClip: (sequenceId: string, atPx: number) => string | null;
  // Clips de la timeline active, timelines imbriquées dépliées (lecteur, export)
  flatClips: Clip[];
  // Toutes les pistes du projet (les clips dépliés peuvent venir d'autres timelines)
  allTracks: Track[];

  // Marqueurs (discrets)
  markers: Marker[];
  addMarker: (timePx: number) => string;
  deleteMarker: (id: string) => void;
  updateMarker: (id: string, patch: Partial<Pick<Marker, 'time' | 'label'>>) => void;

  // UI
  previewAsset: Asset | null;
  setPreviewAsset: (asset: Asset | null) => void;
  scale: number;
  projectSettings: ProjectSettings;
  currentView: ViewMode;
  setCurrentView: (view: ViewMode) => void;
  activeTool: ToolMode;
  setActiveTool: (tool: ToolMode) => void;
  zoomLevel: number;
  setZoomLevel: Dispatch<SetStateAction<number>>;
  // Préférence hors projet et hors historique (localStorage `fullcrea_snap`)
  snapEnabled: boolean;
  setSnapEnabled: (v: boolean) => void;

  // Sélection, dérivée des clips : jamais un id inexistant ni verrouillé
  selectedClipIds: string[];
  selectedClipIdSet: ReadonlySet<string>;
  selectedClipId: string | null;
  selectClip: (id: string, mode?: SelectMode) => void;
  selectClips: (ids: string[], primary?: string) => void;
  clearSelection: () => void;
  // Compat : id ? selectClip(id, 'replace') : clearSelection()
  setSelectedClipId: (id: string | null) => void;
  selectAllClips: () => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const DEFAULT_SETTINGS: ProjectSettings = { width: 1920, height: 1080, fps: 30 };
const LOCAL_STORAGE_KEY = 'fullcrea_state_v1';
const SNAP_STORAGE_KEY = 'fullcrea_snap';
const SAVE_DEBOUNCE_MS = 600;
// Fenêtre de regroupement pour les mutations sans geste explicite (saisie de
// texte, nudges clavier) : les setClips rapprochés forment une seule entrée.
// Les drags/trims déclarent leur geste via begin/endHistoryGesture.
const HISTORY_COALESCE_MS = 400;
const HISTORY_MAX_ENTRIES = 100;

function getHistory(map: Map<string, ProjectHistory>, scope: string): ProjectHistory {
  let history = map.get(scope);
  if (!history) {
    history = { undo: [], redo: [] };
    map.set(scope, history);
  }
  return history;
}

// La piste texte est dédiée, séparée des pistes vidéo/audio.
// On lui donne l'id 0 (réservé) pour qu'elle reste stable.
export const TEXT_TRACK_ID = 0;

const trackName = (type: 'video' | 'audio', tracks: Track[]) =>
  `${type === 'video' ? 'Video' : 'Audio'} ${tracks.filter(t => t.type === type).length + 1}`;
const nextTrackId = (tracks: Track[]) => Math.max(...tracks.map(t => t.id), 0) + 1;
// Les clips d'une timeline imbriquée gardent leur piste d'origine : les ids de
// piste doivent donc être uniques dans tout le projet, pas seulement par timeline.
const nextProjectTrackId = (p: Project) =>
  Math.max(...p.sequences.flatMap(s => s.tracks.map(t => t.id)), ...p.tracks.map(t => t.id), 0) + 1;

// Pistes audio spéciales, toujours présentes (créées à la volée sur les
// projets existants par ensureSpecialTracks).
const SPECIAL_TRACKS: { kind: TrackKind; name: string }[] = [
  { kind: 'voiceover', name: 'Voix Off' },
  { kind: 'music', name: 'Musique' },
  { kind: 'mic', name: 'Micro' },
];

const buildDefaultTracks = (): Track[] => [
  { id: TEXT_TRACK_ID, type: 'text', name: 'Texte' },
  { id: 1, type: 'video', name: 'Video 1' },
  { id: 2, type: 'audio', name: 'Audio 1' },
  { id: 3, type: 'audio', name: 'Voix Off', kind: 'voiceover' },
  { id: 4, type: 'audio', name: 'Musique', kind: 'music' },
  { id: 5, type: 'audio', name: 'Micro', kind: 'mic' },
];

function ensureSpecialTracks(project: Project): Project {
  const missing = SPECIAL_TRACKS.filter(s => !project.tracks.some(t => t.kind === s.kind));
  if (missing.length === 0) return project;
  const tracks = [...project.tracks];
  for (const s of missing) {
    tracks.push({ id: nextTrackId(tracks), type: 'audio', name: s.name, kind: s.kind });
  }
  return { ...project, tracks };
}

// Pour les projets historiques (avant l'introduction de la piste texte) :
// on garantit qu'une piste 'text' existe et on y rapatrie les clips texte.
function ensureTextTrack(project: Project): Project {
  const hasTextTrack = project.tracks.some(t => t.type === 'text');
  let tracks = project.tracks;
  if (!hasTextTrack) {
    const textTrackId = tracks.some(t => t.id === TEXT_TRACK_ID)
      ? Math.min(...tracks.map(t => t.id), 0) - 1
      : TEXT_TRACK_ID;
    tracks = [{ id: textTrackId, type: 'text', name: 'Texte' }, ...tracks];
  }
  const textTrack = tracks.find(t => t.type === 'text')!;
  const clips = project.clips.map(c =>
    c.type === 'text' && c.track !== textTrack.id ? { ...c, track: textTrack.id } : c
  );
  return { ...project, tracks, clips };
}

export const MAIN_SEQUENCE_ID = 'seq_main';

/**
 * Recopie les données de la timeline active dans `sequences` : c'est
 * `sequences` qui fait foi (persistance, timelines imbriquées), les champs
 * clips/tracks/markers du projet n'en sont que le miroir de travail.
 * Identité préservée quand rien n'a changé (pas de sauvegarde inutile).
 */
function syncActiveSequence(p: Project): Project {
  const active = p.sequences.find(s => s.id === p.activeSequenceId);
  if (!active) return p;
  if (active.clips === p.clips && active.tracks === p.tracks && active.markers === p.markers) return p;
  return {
    ...p,
    sequences: p.sequences.map(s =>
      s.id === p.activeSequenceId ? { ...s, clips: p.clips, tracks: p.tracks, markers: p.markers } : s
    ),
  };
}

// Projet lu depuis le cloud ou localStorage : piste texte garantie, `markers`
// toujours un tableau, et au moins une timeline (les projets antérieurs n'ont
// pas de `sequences` : leur contenu devient la timeline principale).
function normalizeProject(raw: Project): Project {
  const markers = Array.isArray(raw.markers) ? raw.markers : EMPTY_MARKERS;
  const stored = Array.isArray(raw.sequences) ? raw.sequences : [];
  if (stored.length === 0) {
    const p = ensureSpecialTracks(ensureTextTrack(raw));
    const main: Sequence = { id: MAIN_SEQUENCE_ID, name: 'Timeline 1', clips: p.clips, tracks: p.tracks, markers };
    return { ...p, markers, sequences: [main], activeSequenceId: main.id };
  }
  // Chaque timeline reçoit ses garanties (piste texte, pistes spéciales) avec
  // des ids de piste uniques dans tout le projet : les garanties calculées sur
  // le seul miroir étaient auparavant écrasées par la timeline active, et les
  // pistes Voix Off / Musique / Micro n'apparaissaient jamais.
  let nextId = Math.max(...stored.flatMap(s => (Array.isArray(s.tracks) ? s.tracks : []).map(t => t.id)), 0) + 1;
  const sequences = stored.map(s => {
    let tracks: Track[] = Array.isArray(s.tracks) ? s.tracks : [];
    let clips: Clip[] = Array.isArray(s.clips) ? s.clips : [];
    if (!tracks.some(t => t.type === 'text')) {
      tracks = [{ id: nextId++, type: 'text', name: 'Texte' }, ...tracks];
    }
    const textTrack = tracks.find(t => t.type === 'text')!;
    clips = clips.map(c => c.type === 'text' && c.track !== textTrack.id ? { ...c, track: textTrack.id } : c);
    const missing = SPECIAL_TRACKS.filter(sp => !tracks.some(t => t.kind === sp.kind));
    if (missing.length > 0) {
      tracks = [...tracks, ...missing.map(sp => ({ id: nextId++, type: 'audio' as const, name: sp.name, kind: sp.kind }))];
    }
    return { ...s, clips, tracks, markers: Array.isArray(s.markers) ? s.markers : EMPTY_MARKERS };
  });
  const active = sequences.find(s => s.id === raw.activeSequenceId) ?? sequences[0];
  return {
    ...raw,
    sequences,
    activeSequenceId: active.id,
    clips: active.clips,
    tracks: active.tracks,
    markers: active.markers,
  };
}

const buildEmptyProject = (id: string, name: string): Project => normalizeProject({
  id,
  name,
  clips: [],
  tracks: buildDefaultTracks(),
  sequences: [],
  activeSequenceId: MAIN_SEQUENCE_ID,
  assets: [],
  markers: EMPTY_MARKERS,
  projectSettings: { ...DEFAULT_SETTINGS },
  currentView: 'video',
});

const buildInitialDefaultProject = (): Project => normalizeProject({
  id: 'project_default',
  name: 'Mon Film 01',
  clips: [
    { id: 'clip_1', name: 'rush_vacances.mp4', type: 'video', track: 1, start: 100, width: 250, src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
    { id: 'clip_2', name: 'background_loop.mp3', type: 'audio', track: 2, start: 400, width: 300, src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }
  ],
  tracks: buildDefaultTracks(),
  assets: [
    { id: 'asset_1', name: 'rush_vacances.mp4', type: 'video', src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
    { id: 'asset_2', name: 'background_loop.mp3', type: 'audio', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
    { id: 'asset_3', name: 'logo_final.png', type: 'image', src: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=1000&q=80' },
  ],
  markers: EMPTY_MARKERS,
  sequences: [],
  activeSequenceId: MAIN_SEQUENCE_ID,
  projectSettings: { ...DEFAULT_SETTINGS },
  currentView: 'video',
});

export function ProjectProvider({ children, initialProjectId, editToken, readOnly = false, preloadedProject }: ProjectProviderProps) {
  // --- ETAT MULTI-PROJETS ---
  const [projects, setProjects] = useState<Project[]>(() => preloadedProject ? [preloadedProject] : [buildInitialDefaultProject()]);
  const [currentProjectId, setCurrentProjectId] = useState<string>(preloadedProject?.id ?? 'project_default');
  const [userId, setUserId] = useState<string | null>(null);
  // Rôle attribué par un jeton de co-édition, valable pour ce seul projet
  const [tokenAccess, setTokenAccess] = useState<{ projectId: string; role: AccessRole } | null>(null);
  const [projectNotFound, setProjectNotFound] = useState(false);

  const currentProject = useMemo(
    () => projects.find(p => p.id === currentProjectId) ?? projects[0],
    [projects, currentProjectId]
  );

  // --- ETAT UI (global, non rattaché à un projet) ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [activeTool, setActiveTool] = useState<ToolMode>('select');
  const [zoomLevel, setZoomLevel] = useState(1);
  // Seul état brut de sélection ; tout le reste (selectedClipIds, selectedClipId)
  // est dérivé des clips et des pistes du projet courant.
  const [selection, setSelection] = useState<{ ids: string[]; primary: string | null }>({ ids: [], primary: null });
  const [snapEnabled, setSnapEnabledState] = useState(true);

  // --- PERSISTANCE ---
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const userIdRef = useRef<string | null>(null);
  const knownProjectIdsRef = useRef<Set<string>>(new Set(['project_default']));
  const projectsRef = useRef<Project[]>(projects);
  const currentProjectIdRef = useRef<string>(currentProjectId);
  // Dernier état effectivement persisté (identité des références) : évite une
  // sauvegarde et un statut 'dirty' juste après l'hydratation.
  const persistedRef = useRef<{ projects: Project[]; currentProjectId: string } | null>(null);
  // Les sauvegardes cloud sont sérialisées : un upsert = delete + insert par table,
  // deux sauvegardes concurrentes pourraient s'entrelacer et écrire des données périmées.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveSeqRef = useRef(0);
  // Projets déjà écrits tels quels dans le cloud (même référence = inchangé)
  const lastSavedRef = useRef<Map<string, Project>>(new Map());
  const [isHydrated, setIsHydrated] = useState(false);
  const [isPersistenceCloud, setIsPersistenceCloud] = useState(false);
  const [persistenceMode, setPersistenceMode] = useState<PersistenceMode>('local');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Layout effect : l'historique lit projectsRef juste avant chaque mutation,
  // il doit donc refléter le dernier commit de façon synchrone.
  useLayoutEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useLayoutEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  // --- HISTORIQUE UNDO/REDO (par projet, jamais appliqué à un autre projet) ---
  const historyRef = useRef<Map<string, ProjectHistory>>(new Map());
  const lastPushAtRef = useRef<number>(0);
  // Geste explicite (drag/trim) : un seul snapshot au premier setClips du geste,
  // puis aucun push tant que le geste n'est pas terminé, quel que soit le timing.
  const gestureRef = useRef<{ active: boolean; pushed: boolean }>({ active: false, pushed: false });
  // Les piles vivent dans un ref : ce compteur ne sert qu'à déclencher un rendu
  // quand elles changent, pour que canUndo/canRedo soient recalculés.
  const [, setHistoryVersion] = useState(0);

  // Chaque timeline a sa propre pile : annuler n'affecte jamais une autre timeline
  const historyScope = `${currentProjectId}#${currentProject.activeSequenceId}`;
  const historyScopeRef = useRef(historyScope);
  useLayoutEffect(() => { historyScopeRef.current = historyScope; }, [historyScope]);
  const currentHistory = historyRef.current.get(historyScope);
  const canUndo = !!currentHistory && currentHistory.undo.length > 0;
  const canRedo = !!currentHistory && currentHistory.redo.length > 0;

  // Empile l'état courant avant une mutation. `discrete` = action ponctuelle
  // (suppression, duplication, ajout de piste) : toujours empilée et elle
  // ferme le geste en cours, contrairement aux drags qui sont regroupés.
  const recordHistory = useCallback((scope: string, discrete: boolean) => {
    const project = projectsRef.current.find(p => p.id === currentProjectIdRef.current);
    if (!project) return;
    const history = getHistory(historyRef.current, scope);
    const now = Date.now();
    const gesture = gestureRef.current;
    const continuation = !discrete && (gesture.active
      ? gesture.pushed
      : now - lastPushAtRef.current < HISTORY_COALESCE_MS);
    const top = history.undo[history.undo.length - 1];
    const unchanged = !!top && top.clips === project.clips && top.tracks === project.tracks && top.markers === project.markers;
    let changed = false;

    if (!continuation && !unchanged) {
      history.undo.push({ clips: project.clips, tracks: project.tracks, markers: project.markers });
      if (history.undo.length > HISTORY_MAX_ENTRIES) {
        history.undo.splice(0, history.undo.length - HISTORY_MAX_ENTRIES);
      }
      changed = true;
    }
    if (history.redo.length > 0) {
      history.redo = [];
      changed = true;
    }
    // Un geste actif n'empile qu'une fois (même si `unchanged` : le sommet de la
    // pile représente déjà l'état d'avant le geste). Une action ponctuelle le
    // remet à zéro : le prochain mouvement repartira d'un nouveau snapshot.
    gesture.pushed = gesture.active && !discrete;
    lastPushAtRef.current = discrete ? 0 : now;
    if (changed) setHistoryVersion(v => v + 1);
  }, []);

  const beginHistoryGesture = useCallback(() => {
    gestureRef.current = { active: true, pushed: false };
  }, []);

  const endHistoryGesture = useCallback(() => {
    gestureRef.current = { active: false, pushed: false };
    // La prochaine mutation ne fusionne jamais avec ce geste
    lastPushAtRef.current = 0;
  }, []);

  const applySnapshot = useCallback((snapshot: HistorySnapshot) => {
    setProjects(prev => prev.map(p =>
      p.id === currentProjectIdRef.current
        ? syncActiveSequence({ ...p, clips: snapshot.clips, tracks: snapshot.tracks, markers: snapshot.markers })
        : p
    ));
  }, []);

  // Abandon d'un geste (ex. dépôt refusé) : on dépile le snapshot empilé par ce
  // geste et on le ré-applique, sans laisser d'entrée fantôme dans l'historique.
  const cancelHistoryGesture = useCallback(() => {
    const g = gestureRef.current;
    if (g.active && g.pushed) {
      const history = historyRef.current.get(historyScopeRef.current);
      const snap = history?.undo.pop();
      if (snap) applySnapshot(snap);
      setHistoryVersion(v => v + 1);
    }
    endHistoryGesture();
  }, [applySnapshot, endHistoryGesture]);

  const undo = useCallback(() => {
    const history = historyRef.current.get(historyScope);
    const project = projectsRef.current.find(p => p.id === currentProjectId);
    if (!history || !project) return;
    const snapshot = history.undo.pop();
    if (!snapshot) return;
    history.redo.push({ clips: project.clips, tracks: project.tracks, markers: project.markers });
    lastPushAtRef.current = 0;
    gestureRef.current.pushed = false;
    setHistoryVersion(v => v + 1);
    applySnapshot(snapshot);
  }, [currentProjectId, historyScope, applySnapshot]);

  const redo = useCallback(() => {
    const history = historyRef.current.get(historyScope);
    const project = projectsRef.current.find(p => p.id === currentProjectId);
    if (!history || !project) return;
    const snapshot = history.redo.pop();
    if (!snapshot) return;
    history.undo.push({ clips: project.clips, tracks: project.tracks, markers: project.markers });
    lastPushAtRef.current = 0;
    gestureRef.current.pushed = false;
    setHistoryVersion(v => v + 1);
    applySnapshot(snapshot);
  }, [currentProjectId, historyScope, applySnapshot]);

  // « Annuler » d'un toast : n'annule que si l'entrée empilée par l'action est
  // toujours au sommet (même projet, rien fait depuis), sinon ne fait rien.
  const undoIfTop = useCallback((token: HistoryToken): boolean => {
    if (token.scope !== historyScopeRef.current) return false;
    const history = historyRef.current.get(token.scope);
    if (!history || history.undo[history.undo.length - 1] !== token.snapshot) return false;
    undo();
    return true;
  }, [undo]);

  // Raccourcis globaux : Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Y
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (shouldIgnoreShortcut(e)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  // --- HELPERS POUR MUTER LE PROJET COURANT ---
  const updateCurrentProject = useCallback((updater: (p: Project) => Project) => {
    setProjects(prev => prev.map(p => p.id === currentProjectId ? syncActiveSequence(updater(p)) : p));
  }, [currentProjectId]);

  // Variante enregistrée dans l'historique undo/redo (clips, pistes et marqueurs).
  // Règle : toute mutation d'un champ du snapshot passe par ici ; currentView
  // et projectSettings restent hors historique. Pour une action discrète, le
  // jeton rendu désigne le sommet de la pile = l'état d'avant l'action (même si
  // `unchanged` a évité un push : le sommet est alors déjà cet état).
  const updateCurrentProjectWithHistory = useCallback((updater: (p: Project) => Project, discrete = false): HistoryToken | null => {
    recordHistory(historyScope, discrete);
    updateCurrentProject(updater);
    if (!discrete) return null;
    const history = historyRef.current.get(historyScope);
    const top = history?.undo[history.undo.length - 1];
    return top ? { scope: historyScope, snapshot: top } : null;
  }, [historyScope, recordHistory, updateCurrentProject]);

  // Dernier état commité du projet courant (lecture synchrone, sans rendu)
  const getCurrent = useCallback((): Project | undefined =>
    projectsRef.current.find(p => p.id === currentProjectIdRef.current), []);
  const getClips = useCallback((): Clip[] => getCurrent()?.clips ?? [], [getCurrent]);
  const getTracks = useCallback((): Track[] => getCurrent()?.tracks ?? [], [getCurrent]);

  const setClips = useCallback<Dispatch<SetStateAction<Clip[]>>>((action) => {
    updateCurrentProjectWithHistory(p => ({
      ...p,
      clips: typeof action === 'function' ? (action as (prev: Clip[]) => Clip[])(p.clips) : action
    }));
  }, [updateCurrentProjectWithHistory]);

  const setClipsWithoutHistory = useCallback<Dispatch<SetStateAction<Clip[]>>>((action) => {
    updateCurrentProject(p => ({
      ...p,
      clips: typeof action === 'function' ? (action as (prev: Clip[]) => Clip[])(p.clips) : action
    }));
  }, [updateCurrentProject]);

  // --- SÉLECTION ---
  const selectClips = useCallback((ids: string[], primary?: string) => {
    setSelection({ ids: [...ids], primary: primary ?? ids[ids.length - 1] ?? null });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(prev => prev.ids.length === 0 && prev.primary === null ? prev : { ids: [], primary: null });
  }, []);

  const selectClip = useCallback((id: string, mode: SelectMode = 'replace') => {
    const project = getCurrent();
    if (!project) return;
    const clip = project.clips.find(c => c.id === id);
    if (clip && project.tracks.find(t => t.id === clip.track)?.locked) return;
    // 'replace' accepte un clip pas encore commité (setClips puis sélection
    // dans le même tick) : la dérivation l'affichera dès qu'il existera.
    if (mode === 'replace') {
      setSelection({ ids: [id], primary: id });
      return;
    }
    if (!clip) return;
    setSelection(prev => {
      const existing = new Set(project.clips.map(c => c.id));
      const ids = prev.ids.filter(i => existing.has(i));
      if (mode === 'toggle' && ids.includes(id)) {
        const rest = ids.filter(i => i !== id);
        return { ids: rest, primary: rest[rest.length - 1] ?? null };
      }
      if (mode === 'range') {
        const primaryId = prev.primary && ids.includes(prev.primary) ? prev.primary : ids[ids.length - 1];
        const primary = primaryId ? project.clips.find(c => c.id === primaryId) : undefined;
        if (primary && primary.track === clip.track) {
          const lo = Math.min(primary.start, clip.start);
          const hi = Math.max(primary.start, clip.start);
          const inRange = project.clips
            .filter(c => c.track === clip.track && c.start >= lo && c.start <= hi)
            .map(c => c.id);
          const merged = [...ids, ...inRange.filter(i => !ids.includes(i))];
          return { ids: merged, primary: primaryId ?? null };
        }
      }
      // 'add', 'toggle' (absent) et 'range' sans primaire compatible
      return { ids: ids.includes(id) ? ids : [...ids, id], primary: id };
    });
  }, [getCurrent]);

  // Compat : ancienne API à valeur unique
  const setSelectedClipId = useCallback((id: string | null) => {
    if (id) selectClip(id, 'replace');
    else clearSelection();
  }, [selectClip, clearSelection]);

  // Tous les clips non verrouillés des pistes affichées (vue courante)
  const selectAllClips = useCallback(() => {
    const project = getCurrent();
    if (!project) return;
    const allowed = new Set(project.tracks
      .filter(t => !t.locked && (project.currentView === 'video' || t.type === 'audio'))
      .map(t => t.id));
    selectClips(project.clips.filter(c => allowed.has(c.track)).map(c => c.id));
  }, [getCurrent, selectClips]);

  // --- PISTES ---
  // L'id est calculé avant l'updater (StrictMode l'appelle deux fois) ; le
  // garde `some` rend l'updater idempotent.
  const addTrack = useCallback((type: 'video' | 'audio'): number => {
    const current = getCurrent();
    const id = current ? nextProjectTrackId(current) : 1;
    updateCurrentProjectWithHistory(p => p.tracks.some(t => t.id === id) ? p : ({
      ...p,
      tracks: [...p.tracks, { id, type, name: trackName(type, p.tracks) }],
    }), true);
    return id;
  }, [getCurrent, updateCurrentProjectWithHistory]);

  /**
   * Renvoie l'id de la première piste du type demandé (non verrouillée si
   * `unlocked`), en la créant si le projet n'en possède aucune.
   */
  const ensureTrack = useCallback((type: 'video' | 'audio', opts?: { unlocked?: boolean }): number => {
    const existing = getCurrent()?.tracks.find(t => t.type === type && !(opts?.unlocked && t.locked));
    if (existing) return existing.id;
    return addTrack(type);
  }, [getCurrent, addTrack]);

  // `hidden` n'a pas de sens sur la piste texte : ignoré
  const updateTrack = useCallback((id: number, patch: Partial<Pick<Track, 'name' | 'muted' | 'hidden' | 'locked'>>) => {
    updateCurrentProjectWithHistory(p => ({
      ...p,
      tracks: p.tracks.map(t => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (t.type === 'text') delete next.hidden;
        return next;
      }),
    }), true);
  }, [updateCurrentProjectWithHistory]);

  // Refuse la piste texte ; retire la piste ET ses clips en une seule entrée
  const deleteTrack = useCallback((id: number): HistoryToken | null => {
    const track = getCurrent()?.tracks.find(t => t.id === id);
    if (!track || track.type === 'text') return null;
    return updateCurrentProjectWithHistory(p => ({
      ...p,
      tracks: p.tracks.filter(t => t.id !== id),
      clips: p.clips.filter(c => c.track !== id),
    }), true);
  }, [getCurrent, updateCurrentProjectWithHistory]);

  // --- CLIPS ---
  // Dépôt d'un média : piste (existante non verrouillée, sinon créée) et clip
  // dans le même updater = une seule entrée d'historique. `start` = première
  // place libre à partir de la position demandée.
  const insertClip = useCallback((clip: Omit<Clip, 'track'>, trackType: 'video' | 'audio'): { id: string; track: number } => {
    const current = getCurrent();
    const tracks = current?.tracks ?? [];
    const existing = tracks.find(t => t.type === trackType && !t.locked);
    const trackId = existing ? existing.id : (current ? nextProjectTrackId(current) : 1);
    updateCurrentProjectWithHistory(p => {
      const nextTracks = p.tracks.some(t => t.id === trackId)
        ? p.tracks
        : [...p.tracks, { id: trackId, type: trackType, name: trackName(trackType, p.tracks) }];
      const candidate: Clip = { ...clip, track: trackId, start: Math.max(0, clip.start) };
      candidate.start = findFreeStart(p.clips, candidate);
      return { ...p, tracks: nextTracks, clips: [...p.clips, candidate] };
    }, true);
    setSelection({ ids: [clip.id], primary: clip.id });
    return { id: clip.id, track: trackId };
  }, [getCurrent, updateCurrentProjectWithHistory]);

  const insertClipOnTrack = useCallback((clip: Omit<Clip, 'track'>, trackId: number): string => {
    updateCurrentProjectWithHistory(p => {
      if (!p.tracks.some(t => t.id === trackId)) return p;
      const candidate: Clip = { ...clip, track: trackId, start: Math.max(0, clip.start) };
      candidate.start = findFreeStart(p.clips, candidate);
      return { ...p, clips: [...p.clips, candidate] };
    }, true);
    setSelection({ ids: [clip.id], primary: clip.id });
    return clip.id;
  }, [updateCurrentProjectWithHistory]);

  const updateClipFields = useCallback((id: string, patch: Partial<Clip>) => {
    updateCurrentProjectWithHistory(p => ({
      ...p,
      clips: p.clips.map(c => c.id === id ? { ...c, ...patch, id: c.id, track: c.track } : c),
    }), true);
  }, [updateCurrentProjectWithHistory]);

  const deleteClips = useCallback((ids: string[]): HistoryToken | null => {
    const set = new Set(ids);
    if (!getCurrent()?.clips.some(c => set.has(c.id))) return null;
    return updateCurrentProjectWithHistory(p => ({ ...p, clips: p.clips.filter(c => !set.has(c.id)) }), true);
  }, [getCurrent, updateCurrentProjectWithHistory]);

  const deleteClip = useCallback((id: string) => deleteClips([id]), [deleteClips]);

  const rippleDeleteClips = useCallback((ids: string[]): HistoryToken | null => {
    const set = new Set(ids);
    if (!getCurrent()?.clips.some(c => set.has(c.id))) return null;
    return updateCurrentProjectWithHistory(p => ({ ...p, clips: computeRipple(p.clips, ids) }), true);
  }, [getCurrent, updateCurrentProjectWithHistory]);

  // Copies décalées de la largeur du groupe (maxEnd − minStart), puis poussées
  // jusqu'à la première place libre ; les copies deviennent la sélection.
  const duplicateClips = useCallback((ids: string[]): string[] => {
    const set = new Set(ids);
    const originals = (getCurrent()?.clips ?? []).filter(c => set.has(c.id));
    if (originals.length === 0) return [];
    const copyIds = new Map(originals.map(o => [o.id, newId('clip')]));
    updateCurrentProjectWithHistory(p => {
      const sources = p.clips.filter(c => copyIds.has(c.id));
      if (sources.length === 0) return p;
      const minStart = Math.min(...sources.map(c => c.start));
      const maxEnd = Math.max(...sources.map(clipEnd));
      const copies = sources.map(o => {
        const copy: Clip = { ...o, id: copyIds.get(o.id)!, start: o.start + (maxEnd - minStart) };
        if (o.transform) copy.transform = { ...o.transform };
        return copy;
      });
      const delta = findFreeGroupDelta(p.clips, copies);
      return { ...p, clips: [...p.clips, ...copies.map(c => ({ ...c, start: c.start + delta }))] };
    }, true);
    const newIds = originals.map(o => copyIds.get(o.id)!);
    setSelection({ ids: newIds, primary: newIds[newIds.length - 1] });
    return newIds;
  }, [getCurrent, updateCurrentProjectWithHistory]);

  const duplicateClip = useCallback((id: string) => duplicateClips([id]), [duplicateClips]);

  // Coupe les clips traversés par `timePx` (non verrouillés) en une seule
  // mutation ; renvoie les ids des moitiés droites. Les ids sont générés avant
  // l'updater pour rester stables si React l'appelle deux fois.
  const splitClipsAt = useCallback((ids: string[], timePx: number): string[] => {
    const project = getCurrent();
    if (!project) return [];
    const set = new Set(ids);
    const locked = new Set(project.tracks.filter(t => t.locked).map(t => t.id));
    const plan = new Map<string, [string, string]>();
    for (const c of project.clips) {
      if (!set.has(c.id) || locked.has(c.track)) continue;
      if (!splitClip(c, timePx, ['a', 'b'])) continue;
      plan.set(c.id, [newId('clip'), newId('clip')]);
    }
    if (plan.size === 0) return [];
    updateCurrentProjectWithHistory(p => ({
      ...p,
      clips: p.clips.flatMap(c => {
        const pair = plan.get(c.id);
        return pair ? (splitClip(c, timePx, pair) ?? [c]) : [c];
      }),
    }), true);
    return [...plan.values()].map(([, right]) => right);
  }, [getCurrent, updateCurrentProjectWithHistory]);

  // Volume/muet : discret par défaut ; `discrete = false` pour un slider
  // (encadré par begin/endHistoryGesture)
  const updateClips = useCallback((ids: string[], patch: Partial<Pick<Clip, 'volume' | 'muted'>>, discrete = true) => {
    const set = new Set(ids);
    updateCurrentProjectWithHistory(p => ({
      ...p,
      clips: p.clips.map(c => set.has(c.id) ? { ...c, ...patch } : c),
    }), discrete);
  }, [updateCurrentProjectWithHistory]);

  // Collage groupé à `atPx` : écarts conservés, piste d'origine si elle existe
  // et n'est pas verrouillée (sinon première piste libre du type, créée au
  // besoin dans le même updater), puis décalage jusqu'à une place libre.
  const pasteClips = useCallback((source: Clip[], atPx: number): string[] => {
    const project = getCurrent();
    if (!project || source.length === 0) return [];
    const minStart = Math.min(...source.map(c => c.start));
    const textTrack = project.tracks.find(t => t.type === 'text')?.id ?? TEXT_TRACK_ID;
    // Pistes cibles décidées avant l'updater (ids des pistes à créer inclus)
    const created: Track[] = [];
    const targetTrack = (c: Clip): number => {
      if (c.type === 'text') return textTrack;
      const own = project.tracks.find(t => t.id === c.track);
      if (own && own.type !== 'text' && !own.locked) return own.id;
      const type = c.type === 'audio' ? 'audio' : 'video';
      const free = project.tracks.find(t => t.type === type && !t.locked) ?? created.find(t => t.type === type);
      if (free) return free.id;
      const t: Track = { id: nextTrackId([...project.tracks, ...created]), type, name: trackName(type, [...project.tracks, ...created]) };
      created.push(t);
      return t.id;
    };
    const pasted = source.map(c => {
      const copy: Clip = { ...c, id: newId('clip'), track: targetTrack(c), start: Math.max(0, atPx) + (c.start - minStart) };
      if (c.transform) copy.transform = { ...c.transform };
      return copy;
    });
    updateCurrentProjectWithHistory(p => {
      const tracks = [...p.tracks, ...created.filter(t => !p.tracks.some(x => x.id === t.id))];
      const delta = findFreeGroupDelta(p.clips, pasted);
      return { ...p, tracks, clips: [...p.clips, ...pasted.map(c => ({ ...c, start: c.start + delta }))] };
    }, true);
    const ids = pasted.map(c => c.id);
    setSelection({ ids, primary: ids[ids.length - 1] });
    return ids;
  }, [getCurrent, updateCurrentProjectWithHistory]);

  const setAssets = useCallback<Dispatch<SetStateAction<Asset[]>>>((action) => {
    updateCurrentProject(p => ({
      ...p,
      assets: typeof action === 'function' ? (action as (prev: Asset[]) => Asset[])(p.assets) : action
    }));
  }, [updateCurrentProject]);

  // --- TIMELINES DU PROJET (séquences) ---
  // Hors historique : créer, renommer ou supprimer une timeline est une action
  // de structure du projet, pas une édition de montage (chaque timeline a sa
  // propre pile undo/redo).
  const resetEditingState = useCallback(() => {
    setSelection({ ids: [], primary: null });
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
    lastPushAtRef.current = 0;
    gestureRef.current = { active: false, pushed: false };
  }, []);

  const createSequence = useCallback((name?: string): string => {
    const id = newId('seq');
    const trimmed = name?.trim() ?? '';
    updateCurrentProject(p => {
      if (p.sequences.some(s => s.id === id)) return p;
      // Ids de piste uniques dans tout le projet : les clips d'une timeline
      // imbriquée conservent leur piste une fois dépliés.
      let nextId = nextProjectTrackId(p);
      const tracks: Track[] = [
        { id: nextId++, type: 'text', name: 'Texte' },
        { id: nextId++, type: 'video', name: 'Video 1' },
        { id: nextId++, type: 'audio', name: 'Audio 1' },
        ...SPECIAL_TRACKS.map(sp => ({ id: nextId++, type: 'audio' as const, name: sp.name, kind: sp.kind })),
      ];
      const used = new Set(p.sequences.map(s => s.name));
      let n = p.sequences.length + 1;
      let seqName = trimmed;
      while (!seqName || used.has(seqName)) { seqName = `Timeline ${n}`; n += 1; }
      const sequence: Sequence = { id, name: seqName, clips: [], tracks, markers: EMPTY_MARKERS };
      return {
        ...p,
        sequences: [...p.sequences, sequence],
        activeSequenceId: id,
        clips: sequence.clips,
        tracks: sequence.tracks,
        markers: sequence.markers,
      };
    });
    resetEditingState();
    return id;
  }, [updateCurrentProject, resetEditingState]);

  const selectSequence = useCallback((id: string) => {
    if (getCurrent()?.activeSequenceId === id) return;
    updateCurrentProject(p => {
      const target = p.sequences.find(s => s.id === id);
      if (!target) return p;
      // On range la timeline sortante ici : syncActiveSequence, appliqué après
      // cet updater, recopierait sinon son contenu dans la nouvelle.
      const sequences = p.sequences.map(s =>
        s.id === p.activeSequenceId ? { ...s, clips: p.clips, tracks: p.tracks, markers: p.markers } : s
      );
      const next = sequences.find(s => s.id === id)!;
      return {
        ...p,
        sequences,
        activeSequenceId: id,
        clips: next.clips,
        tracks: next.tracks,
        markers: next.markers,
      };
    });
    resetEditingState();
  }, [getCurrent, updateCurrentProject, resetEditingState]);

  const renameSequence = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateCurrentProject(p => ({
      ...p,
      sequences: p.sequences.map(s => s.id === id ? { ...s, name: trimmed } : s),
    }));
  }, [updateCurrentProject]);

  // Réordonne les timelines du projet (hors historique, comme les autres
  // actions de structure).
  const moveSequence = useCallback((id: string, toIndex: number) => {
    updateCurrentProject(p => {
      const from = p.sequences.findIndex(s => s.id === id);
      if (from < 0) return p;
      const to = Math.min(Math.max(0, toIndex), p.sequences.length - 1);
      if (to === from) return p;
      const sequences = [...p.sequences];
      const [moved] = sequences.splice(from, 1);
      sequences.splice(to, 0, moved);
      return { ...p, sequences };
    });
  }, [updateCurrentProject]);

  // Supprime la timeline et les clips qui l'insèrent dans les autres timelines.
  // La dernière timeline d'un projet ne peut pas être supprimée.
  const deleteSequence = useCallback((id: string) => {
    const project = getCurrent();
    if (!project || project.sequences.length <= 1) return;
    const wasActive = project.activeSequenceId === id;
    updateCurrentProject(p => {
      if (p.sequences.length <= 1 || !p.sequences.some(s => s.id === id)) return p;
      const stashed = p.sequences.map(s =>
        s.id === p.activeSequenceId ? { ...s, clips: p.clips, tracks: p.tracks, markers: p.markers } : s
      );
      const sequences = stashed
        .filter(s => s.id !== id)
        .map(s => {
          const clips = s.clips.filter(c => !(c.type === 'sequence' && c.sequenceRef === id));
          return clips.length === s.clips.length ? s : { ...s, clips };
        });
      const active = sequences.find(s => s.id === p.activeSequenceId) ?? sequences[0];
      return {
        ...p,
        sequences,
        activeSequenceId: active.id,
        clips: active.clips,
        tracks: active.tracks,
        markers: active.markers,
      };
    });
    historyRef.current.delete(`${project.id}#${id}`);
    setHistoryVersion(v => v + 1);
    if (wasActive) resetEditingState();
  }, [getCurrent, updateCurrentProject, resetEditingState]);

  /**
   * Timeline d'assemblage : un clip par timeline du projet, bout à bout dans
   * l'ordre courant. Recalculée à chaque appel pour refléter les changements.
   */
  const buildMasterSequence = useCallback((): string => {
    const project = getCurrent();
    if (!project) return '';
    const existing = project.sequences.find(s => s.master);
    const id = existing?.id ?? newId('seq');
    const sources = project.sequences.filter(s => !s.master);

    updateCurrentProject(p => {
      const others = p.sequences.filter(s => !s.master);
      const current = p.sequences.find(s => s.id === id);
      // Pistes propres à l'assemblage (ids uniques dans le projet)
      let nextId = nextProjectTrackId(p);
      const tracks: Track[] = current?.tracks?.length
        ? current.tracks
        : [
          { id: nextId++, type: 'text', name: 'Texte' },
          { id: nextId++, type: 'video', name: 'Video 1' },
          { id: nextId++, type: 'audio', name: 'Audio 1' },
        ];
      const videoTrack = tracks.find(t => t.type === 'video') ?? tracks[0];

      let cursor = 0;
      const clips: Clip[] = others.map((seq, i) => {
        const width = Math.max(MIN_CLIP_WIDTH_PX, sequenceDurationPx(seq.clips));
        const clip: Clip = {
          id: `master_${seq.id}`,
          name: `${i + 1}. ${seq.name}`,
          type: 'sequence',
          track: videoTrack.id,
          start: cursor,
          width,
          src: '',
          sequenceRef: seq.id,
        };
        cursor += width;
        return clip;
      });

      const master: Sequence = {
        id,
        name: current?.name ?? 'Montage complet',
        clips,
        tracks,
        markers: current?.markers ?? EMPTY_MARKERS,
        workArea: current?.workArea ?? null,
        master: true,
      };
      const sequences = current
        ? p.sequences.map(s => s.id === id ? master : s)
        : [...p.sequences, master];
      return {
        ...p,
        sequences,
        activeSequenceId: id,
        clips: master.clips,
        tracks: master.tracks,
        markers: master.markers,
      };
    });
    resetEditingState();
    return sources.length >= 0 ? id : id;
  }, [getCurrent, updateCurrentProject, resetEditingState]);

  /**
   * Insère une autre timeline comme un clip dans la timeline active. Refusé si
   * cela créerait un cycle (une timeline ne peut pas se contenir elle-même).
   */
  const insertSequenceClip = useCallback((sequenceId: string, atPx: number): string | null => {
    const project = getCurrent();
    if (!project) return null;
    const target = project.sequences.find(s => s.id === sequenceId);
    if (!target) return null;
    if (wouldCreateCycle(project.sequences, project.activeSequenceId, sequenceId)) return null;
    const width = Math.max(MIN_CLIP_WIDTH_PX, sequenceDurationPx(target.clips));
    const { id } = insertClip({
      id: newId('seq_clip'),
      name: target.name,
      type: 'sequence',
      src: '',
      start: Math.max(0, atPx),
      width,
      sequenceRef: sequenceId,
    }, 'video');
    return id;
  }, [getCurrent, insertClip]);

  // Clips de la timeline active, timelines imbriquées dépliées : c'est ce que
  // lisent le lecteur et l'export, qui n'ont pas à connaître l'imbrication.
  const flatClips = useMemo(
    () => flattenClips(currentProject.clips, currentProject.sequences),
    [currentProject.clips, currentProject.sequences]
  );

  // Les clips dépliés gardent la piste de leur timeline d'origine : le lecteur
  // et l'export ont besoin de toutes les pistes du projet pour les ordonner.
  const allTracks = useMemo(() => {
    const seen = new Set<number>();
    const out: Track[] = [];
    for (const t of currentProject.tracks) { seen.add(t.id); out.push(t); }
    for (const s of currentProject.sequences) {
      if (s.id === currentProject.activeSequenceId) continue;
      for (const t of s.tracks) if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
    }
    return out;
  }, [currentProject.tracks, currentProject.sequences, currentProject.activeSequenceId]);

  // --- MARQUEURS (discrets) ---
  const addMarker = useCallback((timePx: number): string => {
    const id = newId('marker');
    updateCurrentProjectWithHistory(p => {
      if (p.markers.some(m => m.id === id)) return p;
      const used = new Set(p.markers.map(m => m.label));
      let n = 1;
      while (used.has(`M${n}`)) n += 1;
      return { ...p, markers: [...p.markers, { id, time: Math.max(0, timePx), label: `M${n}` }] };
    }, true);
    return id;
  }, [updateCurrentProjectWithHistory]);

  const deleteMarker = useCallback((id: string) => {
    if (!getCurrent()?.markers.some(m => m.id === id)) return;
    updateCurrentProjectWithHistory(p => {
      const markers = p.markers.filter(m => m.id !== id);
      return { ...p, markers: markers.length === 0 ? EMPTY_MARKERS : markers };
    }, true);
  }, [getCurrent, updateCurrentProjectWithHistory]);

  const updateMarker = useCallback((id: string, patch: Partial<Pick<Marker, 'time' | 'label'>>) => {
    if (!getCurrent()?.markers.some(m => m.id === id)) return;
    updateCurrentProjectWithHistory(p => ({
      ...p,
      markers: p.markers.map(m => m.id === id ? { ...m, ...patch } : m),
    }), true);
  }, [getCurrent, updateCurrentProjectWithHistory]);

  const setCurrentView = useCallback((view: ViewMode) => {
    updateCurrentProject(p => ({ ...p, currentView: view }));
  }, [updateCurrentProject]);

  const setProjectSettings = useCallback((settings: ProjectSettings) => {
    updateCurrentProject(p => ({ ...p, projectSettings: settings }));
  }, [updateCurrentProject]);

  // --- PRÉFÉRENCE AIMANT (lue au montage, jamais dans l'initialiseur : SSR) ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SNAP_STORAGE_KEY);
      if (raw === '0') setSnapEnabledState(false);
    } catch {
      // localStorage indisponible : valeur par défaut
    }
  }, []);

  const setSnapEnabled = useCallback((v: boolean) => {
    setSnapEnabledState(v);
    try { localStorage.setItem(SNAP_STORAGE_KEY, v ? '1' : '0'); } catch {}
  }, []);

  // --- GESTION MULTI-PROJETS ---
  const createProject = useCallback((name?: string) => {
    const id = `project_${Date.now()}`;
    const trimmed = name?.trim() ?? '';
    setProjects(prev => {
      const existingNames = new Set(prev.map(p => p.name));
      let projectName = trimmed;
      if (!projectName) {
        const baseName = 'Nouveau Projet';
        let n = prev.length + 1;
        let candidate = `${baseName} ${n}`;
        while (existingNames.has(candidate)) {
          n += 1;
          candidate = `${baseName} ${n}`;
        }
        projectName = candidate;
      }
      return [...prev, buildEmptyProject(id, projectName)];
    });
    setCurrentProjectId(id);
    setSelection({ ids: [], primary: null });
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
    lastPushAtRef.current = 0;
    gestureRef.current = { active: false, pushed: false };
    return id;
  }, []);

  const selectProject = useCallback((id: string) => {
    setCurrentProjectId(id);
    setSelection({ ids: [], primary: null });
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
    lastPushAtRef.current = 0;
    gestureRef.current = { active: false, pushed: false };
  }, []);

  const renameProject = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));
  }, []);

  const deleteProject = useCallback((id: string) => {
    // Calculé une seule fois pour que le projet de repli et currentProjectId concordent
    const fallbackId = `project_${Date.now()}`;
    setProjects(prev => {
      const remaining = prev.filter(p => p.id !== id);
      if (remaining.length === 0) {
        // Toujours garder au moins un projet (vide, jamais le projet démo :
        // en mode cloud il serait ré-upserté avec son contenu d'exemple)
        return [buildEmptyProject(fallbackId, 'Nouveau Projet 1')];
      }
      return remaining;
    });
    if (id === currentProjectId) {
      const remaining = projectsRef.current.filter(p => p.id !== id);
      setCurrentProjectId(remaining[0]?.id ?? fallbackId);
      setSelection({ ids: [], primary: null });
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setIsPlaying(false);
    }
    for (const scope of [...historyRef.current.keys()]) {
      if (scope.startsWith(`${id}#`)) historyRef.current.delete(scope);
    }
    lastPushAtRef.current = 0;
    gestureRef.current = { active: false, pushed: false };
    setHistoryVersion(v => v + 1);
  }, [currentProjectId]);

  // --- HYDRATATION INITIALE (Supabase ou localStorage) ---
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();
    supabaseRef.current = supabase;
    const supabaseConfigured = !!supabase;

    // Les données hydratées remplacent l'état initial sans créer d'entrée d'historique
    const resetHistory = () => {
      historyRef.current.clear();
      lastPushAtRef.current = 0;
      gestureRef.current = { active: false, pushed: false };
      setHistoryVersion(v => v + 1);
    };

    // Projet demandé par l'URL s'il fait partie de la liste, sinon le premier
    const pickInitial = (list: Project[]) => {
      if (initialProjectId) {
        const found = list.find(p => p.id === initialProjectId);
        if (found) return found.id;
        setProjectNotFound(true);
      }
      return list[0].id;
    };

    (async () => {
      // Aperçu : le projet est fourni, aucune lecture réseau
      if (preloadedProject) {
        persistedRef.current = { projects: projectsRef.current, currentProjectId: currentProjectIdRef.current };
        setPersistenceMode(supabaseConfigured ? 'cloud' : 'local');
        setIsHydrated(true);
        return;
      }

      // Tentative Supabase
      if (supabase) {
        try {
          const user = await getCurrentUser(supabase);
          if (cancelled) return;
          if (user) {
            const userId = user.id;
            setUserEmail(user.email);
            setUserId(userId);

            // Lien de co-édition : l'inscription rend le projet visible par le
            // chargement normal ci-dessous (politiques RLS membres).
            if (editToken) {
              const joined = await joinProjectByToken(supabase, editToken);
              if (cancelled) return;
              if (joined) setTokenAccess({ projectId: joined.projectId, role: joined.role });
            }

            const fetched = (await fetchAllProjects(supabase, userId)).map(normalizeProject);
            if (cancelled) return;
            if (fetched.length > 0) {
              const chosenId = pickInitial(fetched);
              setProjects(fetched);
              setCurrentProjectId(chosenId);
              knownProjectIdsRef.current = new Set(fetched.map(p => p.id));
              lastSavedRef.current = new Map(fetched.map(p => [p.id, p]));
              persistedRef.current = { projects: fetched, currentProjectId: chosenId };
              resetHistory();
            } else {
              if (initialProjectId) setProjectNotFound(true);
              const initial = projectsRef.current;
              for (const p of initial) {
                await upsertProject(supabase, userId, p);
                lastSavedRef.current.set(p.id, p);
              }
              knownProjectIdsRef.current = new Set(initial.map(p => p.id));
              persistedRef.current = { projects: initial, currentProjectId: currentProjectIdRef.current };
            }
            // Le userId n'est validé qu'une fois l'hydratation cloud réussie : en
            // fallback local, la sauvegarde ne doit jamais pousser des projets
            // localStorage périmés dans le cloud.
            userIdRef.current = userId;
            setIsPersistenceCloud(true);
            setPersistenceMode('cloud');
            setPersistenceError(null);
            setIsHydrated(true);
            return;
          }
          // Pas de session active (cas rare : race avec AuthGate)
          userIdRef.current = null;
          setPersistenceError("Session Supabase introuvable. Reconnecte-toi.");
        } catch (e) {
          userIdRef.current = null;
          setIsPersistenceCloud(false);
          console.warn('[fullcrea] Hydratation Supabase échouée, fallback localStorage', e);
          setPersistenceError(e instanceof Error ? e.message : (typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'Erreur Supabase'));
        }
      }

      // Fallback localStorage
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { projects?: Project[]; currentProjectId?: string };
          if (parsed.projects && Array.isArray(parsed.projects) && parsed.projects.length > 0) {
            const migrated = parsed.projects.map(normalizeProject);
            if (!cancelled) {
              const restoredId = initialProjectId ? pickInitial(migrated) : (parsed.currentProjectId ?? migrated[0].id);
              setProjects(migrated);
              setCurrentProjectId(restoredId);
              knownProjectIdsRef.current = new Set(migrated.map(p => p.id));
              persistedRef.current = { projects: migrated, currentProjectId: restoredId };
              resetHistory();
            }
          }
        }
      } catch (e) {
        console.warn('[fullcrea] Lecture localStorage échouée', e);
      }
      if (!cancelled) {
        // Sans données locales, le projet par défaut n'est pas marqué 'dirty' non
        // plus : il est régénéré au prochain chargement et écrit à la première édition.
        if (!persistedRef.current) {
          persistedRef.current = { projects: projectsRef.current, currentProjectId: currentProjectIdRef.current };
          if (initialProjectId && !projectsRef.current.some(p => p.id === initialProjectId)) setProjectNotFound(true);
        }
        setPersistenceMode(supabaseConfigured ? 'local-fallback' : 'local');
        setIsHydrated(true);
      }
    })();

    return () => { cancelled = true; };
    // Les props de mode ne changent pas pendant la vie du provider : une route
    // (/, /editor/[id]) monte son propre provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- RÔLE D'ACCÈS AU PROJET COURANT ---
  const accessRole = useMemo<AccessRole>(() => {
    if (tokenAccess && tokenAccess.projectId === currentProjectId) return tokenAccess.role;
    if (!currentProject.ownerId || !userId) return 'owner';
    return currentProject.ownerId === userId ? 'owner' : 'editor';
  }, [tokenAccess, currentProjectId, currentProject.ownerId, userId]);
  const effectiveReadOnly = readOnly || accessRole === 'viewer';

  // --- SUIVI DE LA SESSION SUPABASE (email affiché dans l'UI) ---
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /**
   * Force une sauvegarde immédiate du cloud, sans attendre le debounce. Utilisée
   * avant d'ouvrir un lien de partage : le spectateur doit voir l'état courant
   * (par exemple la timeline d'assemblage tout juste construite).
   * Deux rAF laissent React committer les setState déclenchés juste avant.
   */
  const saveNow = useCallback(async (): Promise<void> => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const supabase = supabaseRef.current;
    const userId = userIdRef.current;
    if (!supabase || !userId) return;
    const run = saveChainRef.current.then(async () => {
      // Seul le projet courant est écrit : c'est lui que le lien va montrer
      const p = projectsRef.current.find(x => x.id === currentProjectIdRef.current);
      if (!p || lastSavedRef.current.get(p.id) === p) return;
      await upsertProject(supabase, userId, p);
      lastSavedRef.current.set(p.id, p);
    });
    // La file de sauvegarde ne doit pas rester bloquée sur un échec
    saveChainRef.current = run.catch(() => {});
    await run;
  }, []);

  // --- SAUVEGARDE DEBOUNCED ---
  useEffect(() => {
    if (!isHydrated || effectiveReadOnly) return;
    // Rien à écrire si l'état est exactement celui déjà persisté (juste après
    // l'hydratation, ou simple changement de projet courant en mode cloud, où
    // currentProjectId n'est pas persisté).
    const persisted = persistedRef.current;
    const cloud = !!(supabaseRef.current && userIdRef.current);
    if (persisted && persisted.projects === projects && (cloud || persisted.currentProjectId === currentProjectId)) return;
    // Si une nouvelle modification arrive pendant une sauvegarde en cours,
    // le résultat de celle-ci ne doit pas écraser le statut 'dirty'.
    let cancelled = false;
    setSaveStatus('dirty');
    const handle = setTimeout(() => {
      const seq = ++saveSeqRef.current;
      const snapshot = projects;
      const snapshotCurrentId = currentProjectId;
      saveChainRef.current = saveChainRef.current.then(async () => {
        // Un snapshot supplanté pendant l'attente n'est pas écrit : une sauvegarde
        // plus récente est déjà planifiée (ou dans la file) avec l'état à jour.
        if (cancelled || seq !== saveSeqRef.current) return;
        const supabase = supabaseRef.current;
        const userId = userIdRef.current;
        let saved = false;
        setSaveStatus('saving');

        if (supabase && userId) {
          try {
            for (const p of snapshot) {
              if (lastSavedRef.current.get(p.id) === p) continue;
              await upsertProject(supabase, userId, p);
              lastSavedRef.current.set(p.id, p);
            }
            const currentIds = new Set(snapshot.map(p => p.id));
            const orphans = [...knownProjectIdsRef.current].filter(id => !currentIds.has(id));
            for (const id of orphans) {
              await deleteProjectRow(supabase, id);
              lastSavedRef.current.delete(id);
            }
            knownProjectIdsRef.current = currentIds;
            // Reset l'erreur si la sauvegarde réussit après un échec précédent
            setPersistenceError(null);
            saved = true;
          } catch (e) {
            const msg = e instanceof Error
              ? e.message
              : (typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'erreur inconnue');
            console.error('[fullcrea] Sauvegarde Supabase échouée', e);
            setPersistenceError(`Sauvegarde échouée : ${msg}`);
          }
        } else {
          try {
            // Filtre les blob: URLs (URL.createObjectURL) qui ne survivent pas à un reload
            const stripBlob = (clips: Clip[]) => clips.map(c => c.src.startsWith('blob:') ? { ...c, src: '' } : c);
            const sanitized = snapshot.map(p => ({
              ...p,
              assets: p.assets.filter(a => !a.src.startsWith('blob:')),
              clips: stripBlob(p.clips),
              sequences: p.sequences.map(seq => ({ ...seq, clips: stripBlob(seq.clips) })),
            }));
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
              projects: sanitized,
              currentProjectId: snapshotCurrentId,
            }));
            saved = true;
          } catch (e) {
            console.warn('[fullcrea] Écriture localStorage échouée', e);
          }
        }

        if (saved) persistedRef.current = { projects: snapshot, currentProjectId: snapshotCurrentId };
        if (cancelled) return;
        if (saved) {
          setSaveStatus('saved');
          setLastSavedAt(new Date());
        } else {
          setSaveStatus('error');
        }
      }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [projects, currentProjectId, isHydrated, effectiveReadOnly]);

  // Garde-fou : avertit avant de quitter la page tant que les modifications ne
  // sont pas écrites (en mode cloud il n'existe aucune copie locale de secours).
  useBeforeUnload(saveStatus === 'dirty' || saveStatus === 'saving' || saveStatus === 'error');

  // --- UPLOAD D'UN FICHIER (Supabase Storage si configuré) ---
  const uploadAssetFile = useCallback(async (file: File): Promise<Asset> => {
    if (effectiveReadOnly) throw new Error('Projet en lecture seule');
    let type: 'video' | 'audio' | 'image' = 'image';
    if (file.type.startsWith('video')) type = 'video';
    else if (file.type.startsWith('audio')) type = 'audio';

    const supabase = supabaseRef.current;
    const userId = userIdRef.current;

    // Mode cloud : on échoue fort si l'upload ne marche pas. On NE retombe
    // PAS sur un blob: URL silencieusement (qui serait filtré à la save).
    if (supabase && userId && currentProjectId) {
      const result = await uploadAsset(supabase, userId, currentProjectId, file);
      return {
        id: `imported_${Date.now()}`,
        name: file.name,
        type,
        src: result.src,
      };
    }

    // Mode local : blob URL, valide pour la session courante seulement.
    return {
      id: `imported_${Date.now()}`,
      name: file.name,
      type,
      src: URL.createObjectURL(file),
    };
  }, [currentProjectId, effectiveReadOnly]);

  // --- DURÉE DU PROJET (px à zoom 1) ---
  const projectDurationPx = useMemo(
    () => currentProject.clips.reduce((max, c) => Math.max(max, c.start + c.width), 0),
    [currentProject.clips]
  );

  // --- SÉLECTION DÉRIVÉE ---
  // Invariants par construction : ids existants, jamais sur une piste
  // verrouillée ; le primaire retiré promeut le dernier id restant.
  const selectedClipIds = useMemo(() => {
    const locked = new Set(currentProject.tracks.filter(t => t.locked).map(t => t.id));
    const byId = new Map(currentProject.clips.map(c => [c.id, c]));
    return selection.ids.filter(id => {
      const c = byId.get(id);
      return !!c && !locked.has(c.track);
    });
  }, [selection.ids, currentProject.clips, currentProject.tracks]);
  const selectedClipIdSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const selectedClipId = selection.primary !== null && selectedClipIdSet.has(selection.primary)
    ? selection.primary
    : (selectedClipIds[selectedClipIds.length - 1] ?? null);

  // Seuil d'arrêt automatique de la lecture ; null = aucun clip, on ne stoppe jamais
  const autoStopAtRef = useRef<number | null>(null);
  useEffect(() => {
    autoStopAtRef.current = currentProject.clips.length > 0 ? projectDurationPx + 1 : null;
  }, [projectDurationPx, currentProject.clips.length]);

  // --- MOTEUR DE LECTURE HAUTE PRÉCISION ---
  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const baseTimeRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);
  const timeSubscribersRef = useRef<Set<TimeSubscriber>>(new Set());

  const subscribeToTime = useCallback((callback: TimeSubscriber) => {
    timeSubscribersRef.current.add(callback);
    callback(currentTimeRef.current);
    return () => {
      timeSubscribersRef.current.delete(callback);
    };
  }, []);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // Miroir synchrone de isPlaying : togglePlay doit brancher sans setState
  // dans un updater (le reset de la tête de lecture est un setState).
  const isPlayingRef = useRef(false);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const togglePlay = useCallback(() => {
    const next = !isPlayingRef.current;
    isPlayingRef.current = next;
    if (next) {
      // Relance depuis le début si la tête est en fin de projet (après l'arrêt
      // automatique), sinon la première frame redéclencherait l'arrêt.
      const stopAt = autoStopAtRef.current;
      if (stopAt !== null && currentTimeRef.current >= stopAt - 1) {
        currentTimeRef.current = 0;
        setCurrentTime(0);
      }
      startTimeRef.current = performance.now();
      baseTimeRef.current = currentTimeRef.current;
    }
    setIsPlaying(next);
  }, []);

  useEffect(() => {
    let frameCount = 0;
    const UI_UPDATE_INTERVAL = 10;

    const update = (now: number) => {
      if (isPlaying) {
        const elapsedSeconds = (now - startTimeRef.current) / 1000;
        const newTime = baseTimeRef.current + (elapsedSeconds * PX_PER_SEC_BASE);

        currentTimeRef.current = newTime;
        timeSubscribersRef.current.forEach(callback => callback(newTime));

        // Arrêt automatique en fin de projet pour que la tête de lecture ne file pas à l'infini
        const stopAt = autoStopAtRef.current;
        if (stopAt !== null && newTime > stopAt) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          return;
        }

        frameCount++;
        if (frameCount >= UI_UPDATE_INTERVAL) {
          frameCount = 0;
          setCurrentTime(newTime);
        }

        requestRef.current = requestAnimationFrame(update);
      }
    };

    if (isPlaying) {
      requestRef.current = requestAnimationFrame(update);
    } else {
      setCurrentTime(currentTimeRef.current);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying]);

  return (
    <ProjectContext.Provider value={{
      projects, currentProjectId, currentProject,
      createProject, selectProject, renameProject, deleteProject,
      isHydrated, isPersistenceCloud, persistenceMode, persistenceError, uploadAssetFile,
      saveStatus, lastSavedAt, userEmail, userId,
      readOnly: effectiveReadOnly, accessRole, projectNotFound,
      undo, redo, canUndo, canRedo, beginHistoryGesture, endHistoryGesture, cancelHistoryGesture, undoIfTop,
      isPlaying, togglePlay, currentTime, setCurrentTime,
      currentTimeRef, subscribeToTime,
      clips: currentProject.clips, setClips, setClipsWithoutHistory, getClips, getTracks,
      insertClip, insertClipOnTrack, updateClipFields, deleteClips, deleteClip, duplicateClips, duplicateClip, rippleDeleteClips, splitClipsAt, updateClips, pasteClips,
      projectDurationPx,
      tracks: currentProject.tracks, addTrack, ensureTrack, updateTrack, deleteTrack,
      textTrackId: (currentProject.tracks.find(t => t.type === 'text')?.id ?? TEXT_TRACK_ID),
      assets: currentProject.assets, setAssets,
      markers: currentProject.markers, addMarker, deleteMarker, updateMarker,
      sequences: currentProject.sequences, activeSequenceId: currentProject.activeSequenceId,
      createSequence, selectSequence, renameSequence, moveSequence, deleteSequence, insertSequenceClip,
      buildMasterSequence,
      saveNow,
      flatClips, allTracks,
      previewAsset, setPreviewAsset, scale: PX_PER_SEC_BASE * zoomLevel,
      projectSettings: currentProject.projectSettings, setProjectSettings,
      currentView: currentProject.currentView, setCurrentView,
      activeTool, setActiveTool,
      zoomLevel, setZoomLevel, snapEnabled, setSnapEnabled,
      selectedClipIds, selectedClipIdSet, selectedClipId,
      selectClip, selectClips, clearSelection, setSelectedClipId, selectAllClips,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) throw new Error("useProject must be used within a ProjectProvider");
  return context;
}
