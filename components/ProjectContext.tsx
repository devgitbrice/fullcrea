"use client";

import { shouldIgnoreShortcut } from '@/lib/keyboard';
import { createContext, useContext, useState, useEffect, useLayoutEffect, useRef, ReactNode, Dispatch, SetStateAction, useCallback, useMemo, MutableRefObject } from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, getCurrentUser } from '@/lib/supabase/client';
import { fetchAllProjects, upsertProject, deleteProjectRow, uploadAsset } from '@/lib/supabase/projectsRepo';
import { useBeforeUnload } from '@/lib/hooks/useBeforeUnload';

// --- INTERFACES ---
export interface ImageTransform {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  positionX: number;
  positionY: number;
}

export const defaultImageTransform: ImageTransform = {
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scaleX: 1,
  scaleY: 1,
  positionX: 0,
  positionY: 0,
};

export interface Clip {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image' | 'text';
  track: number;
  start: number;
  width: number;
  src: string;
  transform?: ImageTransform;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
}

export interface Asset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  src: string;
}

export type ViewMode = 'video' | 'podcast' | 'music';
export type ToolMode = 'select' | 'cut' | 'text';

export interface Track {
  id: number;
  type: 'video' | 'audio' | 'text';
  name: string;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
}

export interface Project {
  id: string;
  name: string;
  clips: Clip[];
  tracks: Track[];
  assets: Asset[];
  projectSettings: ProjectSettings;
  currentView: ViewMode;
}

type TimeSubscriber = (time: number) => void;

export type PersistenceMode = 'cloud' | 'local' | 'local-fallback';

// idle = avant l'hydratation
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface HistorySnapshot {
  clips: Clip[];
  tracks: Track[];
}

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

  // Historique (undo/redo)
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Geste explicite (drag/trim) : une seule entrée d'historique du début à la fin
  beginHistoryGesture: () => void;
  endHistoryGesture: () => void;

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
  // Mise à jour hors historique (ex. largeur naturelle d'un clip après probe async)
  setClipsWithoutHistory: Dispatch<SetStateAction<Clip[]>>;
  deleteClip: (id: string) => void;
  duplicateClip: (id: string) => void;
  projectDurationPx: number;
  tracks: Track[];
  addTrack: (type: 'video' | 'audio') => void;
  textTrackId: number;
  assets: Asset[];
  setAssets: Dispatch<SetStateAction<Asset[]>>;
  setProjectSettings: (settings: ProjectSettings) => void;

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
  selectedClipId: string | null;
  setSelectedClipId: Dispatch<SetStateAction<string | null>>;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

const DEFAULT_SETTINGS: ProjectSettings = { width: 1920, height: 1080, fps: 30 };
const LOCAL_STORAGE_KEY = 'fullcrea_state_v1';
const SAVE_DEBOUNCE_MS = 600;
// Fenêtre de regroupement pour les mutations sans geste explicite (saisie de
// texte, nudges clavier) : les setClips rapprochés forment une seule entrée.
// Les drags/trims déclarent leur geste via begin/endHistoryGesture.
const HISTORY_COALESCE_MS = 400;
const HISTORY_MAX_ENTRIES = 100;

function getHistory(map: Map<string, ProjectHistory>, projectId: string): ProjectHistory {
  let history = map.get(projectId);
  if (!history) {
    history = { undo: [], redo: [] };
    map.set(projectId, history);
  }
  return history;
}

// La piste texte est dédiée, séparée des pistes vidéo/audio.
// On lui donne l'id 0 (réservé) pour qu'elle reste stable.
export const TEXT_TRACK_ID = 0;

const buildDefaultTracks = (): Track[] => [
  { id: TEXT_TRACK_ID, type: 'text', name: 'Texte' },
  { id: 1, type: 'video', name: 'Video 1' },
  { id: 2, type: 'audio', name: 'Audio 1' }
];

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

const buildEmptyProject = (id: string, name: string): Project => ({
  id,
  name,
  clips: [],
  tracks: buildDefaultTracks(),
  assets: [],
  projectSettings: { ...DEFAULT_SETTINGS },
  currentView: 'video',
});

const buildInitialDefaultProject = (): Project => ({
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
  projectSettings: { ...DEFAULT_SETTINGS },
  currentView: 'video',
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  // --- ETAT MULTI-PROJETS ---
  const [projects, setProjects] = useState<Project[]>(() => [buildInitialDefaultProject()]);
  const [currentProjectId, setCurrentProjectId] = useState<string>('project_default');

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
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const PX_PER_SEC_BASE = 30;

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

  const currentHistory = historyRef.current.get(currentProjectId);
  const canUndo = !!currentHistory && currentHistory.undo.length > 0;
  const canRedo = !!currentHistory && currentHistory.redo.length > 0;

  // Empile l'état courant avant une mutation. `discrete` = action ponctuelle
  // (suppression, duplication, ajout de piste) : toujours empilée et elle
  // ferme le geste en cours, contrairement aux drags qui sont regroupés.
  const recordHistory = useCallback((projectId: string, discrete: boolean) => {
    const project = projectsRef.current.find(p => p.id === projectId);
    if (!project) return;
    const history = getHistory(historyRef.current, projectId);
    const now = Date.now();
    const gesture = gestureRef.current;
    const continuation = !discrete && (gesture.active
      ? gesture.pushed
      : now - lastPushAtRef.current < HISTORY_COALESCE_MS);
    const top = history.undo[history.undo.length - 1];
    const unchanged = !!top && top.clips === project.clips && top.tracks === project.tracks;
    let changed = false;

    if (!continuation && !unchanged) {
      history.undo.push({ clips: project.clips, tracks: project.tracks });
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

  const applySnapshot = useCallback((projectId: string, snapshot: HistorySnapshot) => {
    setProjects(prev => prev.map(p =>
      p.id === projectId ? { ...p, clips: snapshot.clips, tracks: snapshot.tracks } : p
    ));
    setSelectedClipId(sel => sel !== null && snapshot.clips.some(c => c.id === sel) ? sel : null);
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current.get(currentProjectId);
    const project = projectsRef.current.find(p => p.id === currentProjectId);
    if (!history || !project) return;
    const snapshot = history.undo.pop();
    if (!snapshot) return;
    history.redo.push({ clips: project.clips, tracks: project.tracks });
    lastPushAtRef.current = 0;
    gestureRef.current.pushed = false;
    setHistoryVersion(v => v + 1);
    applySnapshot(currentProjectId, snapshot);
  }, [currentProjectId, applySnapshot]);

  const redo = useCallback(() => {
    const history = historyRef.current.get(currentProjectId);
    const project = projectsRef.current.find(p => p.id === currentProjectId);
    if (!history || !project) return;
    const snapshot = history.redo.pop();
    if (!snapshot) return;
    history.undo.push({ clips: project.clips, tracks: project.tracks });
    lastPushAtRef.current = 0;
    gestureRef.current.pushed = false;
    setHistoryVersion(v => v + 1);
    applySnapshot(currentProjectId, snapshot);
  }, [currentProjectId, applySnapshot]);

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
    setProjects(prev => prev.map(p => p.id === currentProjectId ? updater(p) : p));
  }, [currentProjectId]);

  // Variante enregistrée dans l'historique undo/redo (clips et pistes uniquement)
  const updateCurrentProjectWithHistory = useCallback((updater: (p: Project) => Project, discrete = false) => {
    recordHistory(currentProjectId, discrete);
    updateCurrentProject(updater);
  }, [currentProjectId, recordHistory, updateCurrentProject]);

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

  const deleteClip = useCallback((id: string) => {
    const project = projectsRef.current.find(p => p.id === currentProjectId);
    if (!project?.clips.some(c => c.id === id)) return;
    updateCurrentProjectWithHistory(p => ({ ...p, clips: p.clips.filter(c => c.id !== id) }), true);
    setSelectedClipId(prev => prev === id ? null : prev);
  }, [currentProjectId, updateCurrentProjectWithHistory]);

  const duplicateClip = useCallback((id: string) => {
    const project = projectsRef.current.find(p => p.id === currentProjectId);
    const original = project?.clips.find(c => c.id === id);
    if (!original) return;
    const copy: Clip = {
      ...original,
      id: `${id}_copy_${Date.now()}`,
      start: original.start + original.width,
    };
    if (original.transform) copy.transform = { ...original.transform };
    updateCurrentProjectWithHistory(p => ({ ...p, clips: [...p.clips, copy] }), true);
    setSelectedClipId(copy.id);
  }, [currentProjectId, updateCurrentProjectWithHistory]);

  const setAssets = useCallback<Dispatch<SetStateAction<Asset[]>>>((action) => {
    updateCurrentProject(p => ({
      ...p,
      assets: typeof action === 'function' ? (action as (prev: Asset[]) => Asset[])(p.assets) : action
    }));
  }, [updateCurrentProject]);

  const addTrack = useCallback((type: 'video' | 'audio') => {
    updateCurrentProjectWithHistory(p => {
      const maxId = Math.max(...p.tracks.map(t => t.id), 0);
      const count = p.tracks.filter(t => t.type === type).length + 1;
      return {
        ...p,
        tracks: [...p.tracks, {
          id: maxId + 1,
          type,
          name: `${type === 'video' ? 'Video' : 'Audio'} ${count}`
        }]
      };
    }, true);
  }, [updateCurrentProjectWithHistory]);

  const setCurrentView = useCallback((view: ViewMode) => {
    updateCurrentProject(p => ({ ...p, currentView: view }));
  }, [updateCurrentProject]);

  const setProjectSettings = useCallback((settings: ProjectSettings) => {
    updateCurrentProject(p => ({ ...p, projectSettings: settings }));
  }, [updateCurrentProject]);

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
    setSelectedClipId(null);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
    lastPushAtRef.current = 0;
    gestureRef.current = { active: false, pushed: false };
    return id;
  }, []);

  const selectProject = useCallback((id: string) => {
    setCurrentProjectId(id);
    setSelectedClipId(null);
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
      setSelectedClipId(null);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setIsPlaying(false);
    }
    historyRef.current.delete(id);
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

    (async () => {
      // Tentative Supabase
      if (supabase) {
        try {
          const user = await getCurrentUser(supabase);
          if (cancelled) return;
          if (user) {
            const userId = user.id;
            setUserEmail(user.email);
            const fetched = (await fetchAllProjects(supabase, userId)).map(ensureTextTrack);
            if (cancelled) return;
            if (fetched.length > 0) {
              setProjects(fetched);
              setCurrentProjectId(fetched[0].id);
              knownProjectIdsRef.current = new Set(fetched.map(p => p.id));
              lastSavedRef.current = new Map(fetched.map(p => [p.id, p]));
              persistedRef.current = { projects: fetched, currentProjectId: fetched[0].id };
              resetHistory();
            } else {
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
            const migrated = parsed.projects.map(ensureTextTrack);
            if (!cancelled) {
              const restoredId = parsed.currentProjectId ?? migrated[0].id;
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
        }
        setPersistenceMode(supabaseConfigured ? 'local-fallback' : 'local');
        setIsHydrated(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // --- SUIVI DE LA SESSION SUPABASE (email affiché dans l'UI) ---
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- SAUVEGARDE DEBOUNCED ---
  useEffect(() => {
    if (!isHydrated) return;
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
            const sanitized = snapshot.map(p => ({
              ...p,
              assets: p.assets.filter(a => !a.src.startsWith('blob:')),
              clips: p.clips.map(c => c.src.startsWith('blob:') ? { ...c, src: '' } : c),
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
  }, [projects, currentProjectId, isHydrated]);

  // Garde-fou : avertit avant de quitter la page tant que les modifications ne
  // sont pas écrites (en mode cloud il n'existe aucune copie locale de secours).
  useBeforeUnload(saveStatus === 'dirty' || saveStatus === 'saving' || saveStatus === 'error');

  // --- UPLOAD D'UN FICHIER (Supabase Storage si configuré) ---
  const uploadAssetFile = useCallback(async (file: File): Promise<Asset> => {
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
  }, [currentProjectId]);

  // --- DURÉE DU PROJET (px à zoom 1) ---
  const projectDurationPx = useMemo(
    () => currentProject.clips.reduce((max, c) => Math.max(max, c.start + c.width), 0),
    [currentProject.clips]
  );

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
      saveStatus, lastSavedAt, userEmail,
      undo, redo, canUndo, canRedo, beginHistoryGesture, endHistoryGesture,
      isPlaying, togglePlay, currentTime, setCurrentTime,
      currentTimeRef, subscribeToTime,
      clips: currentProject.clips, setClips, setClipsWithoutHistory, deleteClip, duplicateClip, projectDurationPx,
      tracks: currentProject.tracks, addTrack,
      textTrackId: (currentProject.tracks.find(t => t.type === 'text')?.id ?? TEXT_TRACK_ID),
      assets: currentProject.assets, setAssets,
      previewAsset, setPreviewAsset, scale: PX_PER_SEC_BASE * zoomLevel,
      projectSettings: currentProject.projectSettings, setProjectSettings,
      currentView: currentProject.currentView, setCurrentView,
      activeTool, setActiveTool,
      zoomLevel, setZoomLevel, selectedClipId, setSelectedClipId
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
