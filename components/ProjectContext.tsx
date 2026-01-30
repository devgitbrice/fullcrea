"use client";

import { createContext, useContext, useState, useEffect, useRef, ReactNode, Dispatch, SetStateAction, useCallback, MutableRefObject } from 'react';

// --- INTERFACES ---
export interface ImageTransform {
  rotationX: number;
  rotationY: number;
  scaleX: number;
  scaleY: number;
  positionX: number;
  positionY: number;
}

export const defaultImageTransform: ImageTransform = {
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
  positionX: 0,
  positionY: 0,
};

export interface Clip {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  track: 1 | 2;
  start: number;
  width: number;
  src: string;
  // Propriétés de transformation pour les images
  transform?: ImageTransform;
}

export interface Asset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  src: string;
}

export type ViewMode = 'video' | 'podcast' | 'music';
export type ToolMode = 'select' | 'cut';

interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
}

// Type pour les subscribers du temps
type TimeSubscriber = (time: number) => void;

interface ProjectContextType {
  isPlaying: boolean;
  togglePlay: () => void;
  currentTime: number;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  // Nouvelle API pour lecture fluide sans re-renders
  currentTimeRef: MutableRefObject<number>;
  subscribeToTime: (callback: TimeSubscriber) => () => void;
  clips: Clip[];
  setClips: Dispatch<SetStateAction<Clip[]>>;
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

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [currentView, setCurrentView] = useState<ViewMode>('video');
  const [activeTool, setActiveTool] = useState<ToolMode>('select');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const PX_PER_SEC_BASE = 30;
  const [projectSettings] = useState<ProjectSettings>({ width: 1920, height: 1080, fps: 30 });

  const [clips, setClips] = useState<Clip[]>([
    { id: 'asset_1', name: 'rush_vacances.mp4', type: 'video', track: 1, start: 100, width: 250, src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' },
    { id: 'asset_2', name: 'background_loop.mp3', type: 'audio', track: 2, start: 400, width: 300, src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }
  ]);

  // --- MOTEUR DE LECTURE HAUTE PRÉCISION (OPTIMISÉ) ---
  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const baseTimeRef = useRef<number>(0);

  // ✅ NOUVEAU: Ref pour le temps courant (pas de re-render)
  const currentTimeRef = useRef<number>(0);
  // ✅ NOUVEAU: Subscribers pour les composants qui veulent suivre le temps
  const timeSubscribersRef = useRef<Set<TimeSubscriber>>(new Set());

  // ✅ Fonction d'abonnement stable
  const subscribeToTime = useCallback((callback: TimeSubscriber) => {
    timeSubscribersRef.current.add(callback);
    // Appeler immédiatement avec la valeur actuelle
    callback(currentTimeRef.current);
    return () => {
      timeSubscribersRef.current.delete(callback);
    };
  }, []);

  // Synchroniser le ref quand le state change (pour scrubbing)
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const togglePlay = () => {
    if (!isPlaying) {
      startTimeRef.current = performance.now();
      baseTimeRef.current = currentTimeRef.current;
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    let frameCount = 0;
    const UI_UPDATE_INTERVAL = 10; // Mettre à jour l'UI toutes les 10 frames (~6x/sec)

    const update = (now: number) => {
      if (isPlaying) {
        const elapsedSeconds = (now - startTimeRef.current) / 1000;
        const newTime = baseTimeRef.current + (elapsedSeconds * PX_PER_SEC_BASE);

        // ✅ Toujours mettre à jour le ref (pour vidéo/audio)
        currentTimeRef.current = newTime;

        // ✅ Notifier les subscribers (playhead, sync vidéo) sans re-render
        timeSubscribersRef.current.forEach(callback => callback(newTime));

        // ✅ Mettre à jour le state moins fréquemment (pour l'affichage du temps)
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
      // Nettoyage si on met en pause - synchroniser le state final
      setCurrentTime(currentTimeRef.current);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying]);

  return (
    <ProjectContext.Provider value={{
      isPlaying, togglePlay, currentTime, setCurrentTime,
      currentTimeRef, subscribeToTime,
      clips, setClips,
      previewAsset, setPreviewAsset, scale: PX_PER_SEC_BASE * zoomLevel,
      projectSettings, currentView, setCurrentView, activeTool, setActiveTool,
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