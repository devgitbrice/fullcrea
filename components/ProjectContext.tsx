"use client";

import { createContext, useContext, useState, useEffect, useRef, ReactNode, Dispatch, SetStateAction, useCallback, useMemo, MutableRefObject } from 'react';

// --- INTERFACES ---
export interface ImageTransform {
  rotationX: number;
  rotationY: number;
  rotationZ: number; // Rotation classique autour du centre
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
  // Propriétés de transformation pour les images
  transform?: ImageTransform;
  // Propriétés pour les clips texte
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
  type: 'video' | 'audio';
  name: string;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
}

// Un projet contient TOUS les éléments d'interface qui lui sont rattachés
export interface Project {
  id: string;
  name: string;
  clips: Clip[];
  tracks: Track[];
  assets: Asset[];
  projectSettings: ProjectSettings;
  currentView: ViewMode;
}

// Type pour les subscribers du temps
type TimeSubscriber = (time: number) => void;

interface ProjectContextType {
  // --- Multi-projets ---
  projects: Project[];
  currentProjectId: string;
  currentProject: Project;
  createProject: (name?: string) => string;
  selectProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;

  // --- Lecture ---
  isPlaying: boolean;
  togglePlay: () => void;
  currentTime: number;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  currentTimeRef: MutableRefObject<number>;
  subscribeToTime: (callback: TimeSubscriber) => () => void;

  // --- Données du projet courant (proxy) ---
  clips: Clip[];
  setClips: Dispatch<SetStateAction<Clip[]>>;
  tracks: Track[];
  addTrack: (type: 'video' | 'audio') => void;
  assets: Asset[];
  setAssets: Dispatch<SetStateAction<Asset[]>>;

  // --- Etat UI global ---
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

const buildDefaultTracks = (): Track[] => [
  { id: 1, type: 'video', name: 'Video 1' },
  { id: 2, type: 'audio', name: 'Audio 1' }
];

const buildEmptyProject = (id: string, name: string): Project => ({
  id,
  name,
  clips: [],
  tracks: buildDefaultTracks(),
  assets: [],
  projectSettings: { ...DEFAULT_SETTINGS },
  currentView: 'video',
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  // --- MULTI-PROJETS ---
  const [projects, setProjects] = useState<Project[]>(() => [{
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
  }]);
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

  // --- HELPERS POUR MUTER LE PROJET COURANT ---
  const updateCurrentProject = useCallback((updater: (p: Project) => Project) => {
    setProjects(prev => prev.map(p => p.id === currentProjectId ? updater(p) : p));
  }, [currentProjectId]);

  const setClips = useCallback<Dispatch<SetStateAction<Clip[]>>>((action) => {
    updateCurrentProject(p => ({
      ...p,
      clips: typeof action === 'function' ? (action as (prev: Clip[]) => Clip[])(p.clips) : action
    }));
  }, [updateCurrentProject]);

  const setAssets = useCallback<Dispatch<SetStateAction<Asset[]>>>((action) => {
    updateCurrentProject(p => ({
      ...p,
      assets: typeof action === 'function' ? (action as (prev: Asset[]) => Asset[])(p.assets) : action
    }));
  }, [updateCurrentProject]);

  const addTrack = useCallback((type: 'video' | 'audio') => {
    updateCurrentProject(p => {
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
    });
  }, [updateCurrentProject]);

  const setCurrentView = useCallback((view: ViewMode) => {
    updateCurrentProject(p => ({ ...p, currentView: view }));
  }, [updateCurrentProject]);

  // --- GESTION MULTI-PROJETS ---
  const createProject = useCallback((name?: string) => {
    const id = `project_${Date.now()}`;
    let projectName = name?.trim() || '';
    if (!projectName) {
      // Calcule un nom unique
      setProjects(prev => {
        const baseName = 'Nouveau Projet';
        let n = prev.length + 1;
        let candidate = `${baseName} ${n}`;
        while (prev.some(p => p.name === candidate)) {
          n += 1;
          candidate = `${baseName} ${n}`;
        }
        return [...prev, { ...buildEmptyProject(id, candidate) }];
      });
    } else {
      setProjects(prev => [...prev, { ...buildEmptyProject(id, projectName) }]);
    }
    setCurrentProjectId(id);
    setSelectedClipId(null);
    setCurrentTime(0);
    setIsPlaying(false);
    return id;
  }, []);

  const selectProject = useCallback((id: string) => {
    setCurrentProjectId(id);
    setSelectedClipId(null);
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const renameProject = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));
  }, []);

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

  const togglePlay = useCallback(() => {
    setIsPlaying(prev => {
      if (!prev) {
        startTimeRef.current = performance.now();
        baseTimeRef.current = currentTimeRef.current;
      }
      return !prev;
    });
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
      createProject, selectProject, renameProject,
      isPlaying, togglePlay, currentTime, setCurrentTime,
      currentTimeRef, subscribeToTime,
      clips: currentProject.clips, setClips,
      tracks: currentProject.tracks, addTrack,
      assets: currentProject.assets, setAssets,
      previewAsset, setPreviewAsset, scale: PX_PER_SEC_BASE * zoomLevel,
      projectSettings: currentProject.projectSettings,
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
