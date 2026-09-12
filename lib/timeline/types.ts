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
  // 'sequence' = une autre timeline du projet insérée comme un bloc
  type: 'video' | 'audio' | 'image' | 'text' | 'sequence';
  track: number;
  start: number;            // px timeline (zoom 1), ≥ 0
  width: number;            // px, ≥ MIN_CLIP_WIDTH_PX
  src: string;
  offset?: number;          // px : point d'entrée dans la source, ≥ 0, défaut 0 (vidéo/audio seulement)
  sourceDuration?: number;  // px : durée réelle du média si connue (probe) ; offset + width ≤ sourceDuration
  volume?: number;          // 0..1, défaut 1 (vidéo/audio)
  muted?: boolean;          // vidéo/audio
  speed?: number;           // vitesse de lecture, 0.25..4, défaut 1 (vidéo/audio)
  fadeIn?: number;          // px : fondu audio d'entrée
  fadeOut?: number;         // px : fondu audio de sortie
  // Transition à l'entrée du clip : recouvre la fin du clip précédent de la
  // même piste (fondu enchaîné). Durée en px.
  transition?: { type: TransitionType; duration: number };
  // Lien vidéo ↔ audio détaché : les deux clips portent le même identifiant
  linkId?: string;
  transform?: ImageTransform;
  // Voix off générée : texte et voix d'origine, pour rééditer et régénérer
  tts?: { text: string; voice: string };
  // Clip de type 'sequence' : id de la timeline insérée
  sequenceRef?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textColor?: string;
}

// Pistes audio spéciales : Voix Off (texte → parole), Musique, Micro
// (enregistrement direct). Elles portent un bouton dédié dans leur en-tête.
export type TrackKind = 'voiceover' | 'music' | 'mic';

/** Transitions disponibles à l'entrée d'un clip visuel. */
export type TransitionType = 'fade' | 'dissolve' | 'wipeleft' | 'wiperight' | 'slideup' | 'circleopen';

export const TRANSITIONS: { id: TransitionType; label: string }[] = [
  { id: 'dissolve', label: 'Fondu enchaîné' },
  { id: 'fade', label: 'Fondu au noir' },
  { id: 'wipeleft', label: 'Balayage ←' },
  { id: 'wiperight', label: 'Balayage →' },
  { id: 'slideup', label: 'Glissement ↑' },
  { id: 'circleopen', label: 'Cercle' },
];

export interface Track {
  id: number;
  type: 'video' | 'audio' | 'text';
  name: string;
  kind?: TrackKind;  // pistes audio seulement
  muted?: boolean;   // pistes vidéo et audio : son coupé (lecteur + export)
  solo?: boolean;    // une piste en solo rend les autres inaudibles
  height?: number;   // hauteur personnalisée (px écran)
  collapsed?: boolean; // piste repliée (hauteur minimale)
  hidden?: boolean;  // pistes vidéo : clips ignorés (image ET son) ; jamais sur la piste texte
  locked?: boolean;  // toutes pistes : clips non sélectionnables/éditables ; dépôt refusé
}

// Label auto « M1 », « M2 »… (renommage reporté)
export interface Marker {
  id: string;
  time: number;
  label: string;
  color?: string;
}

/** Zone de travail : lecture et export limités à cet intervalle (px). */
export interface WorkArea { start: number; end: number }

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

/**
 * Une timeline du projet. Un projet en contient au moins une ; une timeline
 * peut être insérée dans une autre sous forme de clip `type: 'sequence'`.
 */
export interface Sequence {
  id: string;
  name: string;
  clips: Clip[];
  tracks: Track[];
  markers: Marker[];
  /** Zone de travail (in/out) : null = toute la timeline */
  workArea?: WorkArea | null;
  /** Timeline d'assemblage : reprend toutes les autres, dans l'ordre */
  master?: boolean;
}

export interface Project {
  id: string;
  name: string;
  // Données de la timeline ACTIVE (miroir de l'entrée correspondante de
  // `sequences`, tenu à jour à chaque mutation : `sequences` fait foi).
  clips: Clip[];
  tracks: Track[];
  markers: Marker[];   // requis en mémoire (normalisé à l'hydratation : EMPTY_MARKERS si absent)
  // Toutes les timelines du projet, la première étant la principale
  sequences: Sequence[];
  activeSequenceId: string;
  assets: Asset[];
  projectSettings: ProjectSettings;
  currentView: ViewMode;
}

// Référence partagée par tous les projets sans marqueur (gelée : toute
// mutation en place lèverait, les actions créent toujours un nouveau tableau).
// Typée Marker[] pour se glisser dans Project.markers sans cast.
export const EMPTY_MARKERS: Marker[] = Object.freeze([] as Marker[]) as Marker[];
