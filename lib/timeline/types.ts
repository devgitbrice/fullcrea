// Types du modèle de timeline, sans dépendance React : les helpers purs de
// lib/timeline/ sont exécutables par `node --test` sans bundler. ProjectContext
// ré-exporte ces types, les imports existants ne changent pas.

// Unités : positions et durées en px à zoom 1 (30 px = 1 s).
export const PX_PER_SEC_BASE = 30;
// Largeur minimale d'un clip (aligné sur le seuil de trim)
export const MIN_CLIP_WIDTH_PX = 5;

export interface ImageTransform {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  positionX: number;
  positionY: number;
}

export interface Clip {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image' | 'text';
  track: number;
  start: number;            // px timeline (zoom 1), ≥ 0
  width: number;            // px, ≥ MIN_CLIP_WIDTH_PX
  src: string;
  offset?: number;          // px : point d'entrée dans la source, ≥ 0, défaut 0 (vidéo/audio seulement)
  sourceDuration?: number;  // px : durée réelle du média si connue (probe) ; offset + width ≤ sourceDuration
  volume?: number;          // 0..1, défaut 1 (vidéo/audio)
  muted?: boolean;          // vidéo/audio
  transform?: ImageTransform;
  // Voix off générée : texte et voix d'origine, pour rééditer et régénérer
  tts?: { text: string; voice: string };
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
}

// Pistes audio spéciales : Voix Off (texte → parole), Musique, Micro
// (enregistrement direct). Elles portent un bouton dédié dans leur en-tête.
export type TrackKind = 'voiceover' | 'music' | 'mic';

export interface Track {
  id: number;
  type: 'video' | 'audio' | 'text';
  name: string;
  kind?: TrackKind;  // pistes audio seulement
  muted?: boolean;   // pistes vidéo et audio : son coupé (lecteur + export)
  hidden?: boolean;  // pistes vidéo : clips ignorés (image ET son) ; jamais sur la piste texte
  locked?: boolean;  // toutes pistes : clips non sélectionnables/éditables ; dépôt refusé
}

// Label auto « M1 », « M2 »… (renommage reporté)
export interface Marker {
  id: string;
  time: number;
  label: string;
}

export interface Asset {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  src: string;
}

export type ViewMode = 'video' | 'podcast' | 'music';

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
  markers: Marker[];   // requis en mémoire (normalisé à l'hydratation : EMPTY_MARKERS si absent)
  projectSettings: ProjectSettings;
  currentView: ViewMode;
}

// Référence partagée par tous les projets sans marqueur (gelée : toute
// mutation en place lèverait, les actions créent toujours un nouveau tableau).
// Typée Marker[] pour se glisser dans Project.markers sans cast.
export const EMPTY_MARKERS: Marker[] = Object.freeze([] as Marker[]) as Marker[];
