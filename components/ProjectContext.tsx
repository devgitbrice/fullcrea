"use client";

import { createContext, useContext, useState, useEffect, useRef, ReactNode, Dispatch, SetStateAction } from 'react';

// --- INTERFACES ---
export interface Clip {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  track: 1 | 2;
  start: number;
  width: number;
  src: string;
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

interface ProjectContextType {
  isPlaying: boolean;
  togglePlay: () => void;
  currentTime: number;
  setCurrentTime: Dispatch<SetStateAction<number>>;
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

  // --- MOTEUR DE LECTURE HAUTE PRÉCISION ---
  const requestRef = useRef<number>();
  const startTimeRef = useRef<number>(0);
  const baseTimeRef = useRef<number>(0);

  const togglePlay = () => {
    if (!isPlaying) {
      // On mémorise le temps de départ pour le calcul différentiel
      startTimeRef.current = performance.now();
      baseTimeRef.current = currentTime;
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    const update = (now: number) => {
      if (isPlaying) {
        // Calcul précis : (Temps Actuel - Temps au clic Play) / 1000 = secondes écoulées
        const elapsedSeconds = (now - startTimeRef.current) / 1000;
        const newTime = baseTimeRef.current + (elapsedSeconds * PX_PER_SEC_BASE);
        
        setCurrentTime(newTime);
        requestRef.current = requestAnimationFrame(update);
      }
    };

    if (isPlaying) {
      requestRef.current = requestAnimationFrame(update);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying]);

  return (
    <ProjectContext.Provider value={{ 
      isPlaying, togglePlay, currentTime, setCurrentTime, clips, setClips,
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