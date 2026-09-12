"use client";

import { shouldIgnoreShortcut } from '@/lib/keyboard';
import {
  useRef, DragEvent, useState, useEffect, useLayoutEffect, PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo, type ReactNode,
} from 'react';
import { Music, Plus, Video, AudioLines, Type, X, MousePointerClick, MessageSquareText, Film } from 'lucide-react';
import { useProject, Clip, PX_PER_SEC_BASE, MIN_CLIP_WIDTH_PX } from '@/components/ProjectContext';
import {
  newId, neighborBounds, isClipLocked, overlapsOnTrack, findFreeStart, clipEdges, trimBounds, clamp,
} from '@/lib/timeline/clipOps';
import { formatSeconds, formatTimecode } from '@/lib/timeline/format';
import { probeMediaDuration } from '@/lib/media/probe';
import { useToast } from '@/components/Toast';
import TimelineToolbar from './TimelineToolbar';
import AudioWaveform from './AudioWaveform';
import TrackHeader from './TrackHeader';
import VoiceOverModal from './VoiceOverModal';
import MusicPickerModal from './MusicPickerModal';
import type { MicRecording } from '@/lib/hooks/useMicRecorder';
import {
  ASSET_ADD_EVENT,
  ASSET_DROP_EVENT,
  type AssetAddPayload,
  type AssetDropPayload,
} from '@/lib/assetDrag';

// Gouttière des en-têtes de piste : hors de la zone de contenu (règle, tête de
// lecture, conversions). Toute position x « contenu » est décalée d'autant.
export const TRACK_HEADER_W = 112;
const SNAP_THRESHOLD_PX = 10;
const SNAP_THRESHOLD_TOUCH_PX = 14;
// Seuil d'aimantation plafonné en px source (zoom très faible)
const SNAP_MAX_SOURCE_PX = PX_PER_SEC_BASE / 2;
// Seuil de mouvement avant qu'un pointerdown devienne un drag
const MOVE_THRESHOLD_PX = 3;
const MOVE_THRESHOLD_TOUCH_PX = 10;
// Sous cette largeur écran, un clip n'a pas de poignées de trim
const HANDLES_MIN_CLIP_SCREEN_PX = 42;
const HANDLE_MAX_W_PX = 14;
const HANDLE_MIN_W_PX = 4;
// Délai de grâce après un scroll manuel avant que la lecture reprenne le suivi
const FOLLOW_GRACE_MS = 1500;
const RULER_MAJOR_INTERVALS_SEC = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const RULER_MAJOR_MIN_GAP_PX = 90;
const RULER_MINOR_MIN_GAP_PX = 12;
const CONTENT_MIN_MARGIN_PX = 400;
const CONTENT_END_MARGIN_PX = 600;
// Largeur d'un média déposé avant que sa durée réelle soit connue (probe)
const INITIAL_CLIP_WIDTH_PX = 150;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;
const EPSILON = 1e-6;
const OCCUPIED_MESSAGE = 'Emplacement occupé';

function formatPx(px: number): string {
  return formatSeconds(px / PX_PER_SEC_BASE);
}

function pickMajorIntervalSec(zoomLevel: number): number {
  const pxPerSec = PX_PER_SEC_BASE * zoomLevel;
  return RULER_MAJOR_INTERVALS_SEC.find(sec => sec * pxPerSec >= RULER_MAJOR_MIN_GAP_PX)
    ?? RULER_MAJOR_INTERVALS_SEC[RULER_MAJOR_INTERVALS_SEC.length - 1];
}

// Rect d'une ligne de piste mesuré au pointerdown (déplacement vertical)
interface TrackRect {
  id: number;
  type: string;
  locked: boolean;
  top: number;
  bottom: number;
}

export default function Timeline() {
  const timelineRef = useRef<HTMLDivElement>(null);
  // Trait de la tête dans les pistes (pointer-events-none) et losange dans la règle
  const playheadRef = useRef<HTMLDivElement>(null);
  const playheadHandleRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<Clip[]>([]);
  // Durées réelles déjà sondées, par source (px) : un média déposé deux fois
  // n'est sondé qu'une fois.
  const durationCacheRef = useRef<Map<string, number>>(new Map());
  // Geste en cours (drag, trim, scrub) : aucun suivi automatique de la tête
  const gestureActiveRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const lastManualScrollAtRef = useRef(0);
  // Vrai pendant l'écriture de scrollLeft par revealTime : le scroll qui en
  // découle n'est pas « manuel »
  const autoScrollingRef = useRef(false);
  const lastTimeRef = useRef(0);
  // Ancre du zoom Ctrl+molette : point sous le pointeur à conserver
  const zoomAnchorRef = useRef<{ time: number; screenX: number } | null>(null);
  const zoomLevelRef = useRef(1);
  const viewportWidthRef = useRef(0);
  const isPlayingRef = useRef(false);
  const snapEnabledRef = useRef(true);

  const {
    clips,
    setClips,
    setClipsWithoutHistory,
    getClips,
    getTracks,
    insertClip,
    deleteClips,
    duplicateClips,
    rippleDeleteClips,
    splitClipsAt,
    pasteClips,
    beginHistoryGesture,
    endHistoryGesture,
    cancelHistoryGesture,
    undoIfTop,
    projectDurationPx,
    projectSettings,
    currentTime,
    setCurrentTime,
    currentView,
    setCurrentView,
    activeTool,
    setActiveTool,
    zoomLevel,
    setZoomLevel,
    selectedClipIds,
    selectedClipIdSet,
    selectClip,
    selectClips,
    clearSelection,
    selectAllClips,
    isPlaying,
    togglePlay,
    subscribeToTime,
    currentTimeRef,
    tracks,
    addTrack,
    textTrackId,
    markers,
    snapEnabled,
    setSnapEnabled,
    insertClipOnTrack,
    uploadAssetFile,
    setAssets,
    selectSequence,
  } = useProject();
  const { toast } = useToast();

  const [isScrubbing, setIsScrubbing] = useState(false);
  // Clips en cours de drag/trim : pas de transition CSS, opacité réduite
  const [gestureClipIds, setGestureClipIds] = useState<ReadonlySet<string> | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [snapGuideX, setSnapGuideX] = useState<number | null>(null);
  // Tooltip de timecode pendant drag/trim (x en px écran contenu)
  const [gestureLabel, setGestureLabel] = useState<{ x: number; text: string } | null>(null);
  const [cutHover, setCutHover] = useState<{ clipId: string; x: number } | null>(null);
  // Mode « Sélection multiple » (tactile) : tap = toggle, aucun drag
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  // Pistes spéciales : modale Voix Off (création ou édition d'un clip TTS) et choix de musique
  const [voiceOverEditor, setVoiceOverEditor] = useState<{ trackId: number; clip?: Clip } | null>(null);
  const [musicPickerTrack, setMusicPickerTrack] = useState<number | null>(null);

  const fps = Number.isFinite(projectSettings.fps) && projectSettings.fps > 0 ? projectSettings.fps : 30;
  const maxMarkerTime = useMemo(() => markers.reduce((max, m) => Math.max(max, m.time), 0), [markers]);
  const contentWidth = Math.max(
    viewportWidth - TRACK_HEADER_W + CONTENT_MIN_MARGIN_PX,
    Math.max(projectDurationPx, maxMarkerTime) * zoomLevel + CONTENT_END_MARGIN_PX
  );
  const rowWidth = TRACK_HEADER_W + contentWidth;
  const projectEndX = projectDurationPx * zoomLevel;

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { snapEnabledRef.current = snapEnabled; }, [snapEnabled]);
  useEffect(() => { viewportWidthRef.current = viewportWidth; }, [viewportWidth]);

  // --- GÉOMÉTRIE : une seule conversion viewport → px timeline ---
  const timeFromClientX = useCallback((clientX: number): number => {
    const el = timelineRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return (clientX - rect.left - TRACK_HEADER_W + el.scrollLeft) / zoomLevelRef.current;
  }, []);

  // Positionne le trait et le losange ; le losange est masqué quand la tête
  // est sortie à gauche de la zone visible (sinon il flotterait sur la gouttière).
  const syncPlayhead = useCallback((time: number) => {
    lastTimeRef.current = time;
    const x = TRACK_HEADER_W + time * zoomLevelRef.current;
    if (playheadRef.current) playheadRef.current.style.transform = `translateX(${x}px)`;
    const handle = playheadHandleRef.current;
    if (handle) {
      handle.style.transform = `translateX(${x}px)`;
      const scrollLeft = timelineRef.current?.scrollLeft ?? 0;
      handle.style.visibility = time * zoomLevelRef.current < scrollLeft ? 'hidden' : '';
    }
  }, []);

  // Fait défiler pour montrer la tête : « par page », la tête reposée à 10 %
  // de la zone visible. Jamais pendant un geste.
  const revealTime = useCallback((px: number) => {
    const el = timelineRef.current;
    const visibleW = viewportWidthRef.current - TRACK_HEADER_W;
    if (!el || visibleW <= 0) return;
    const x = px * zoomLevelRef.current;
    if (x >= el.scrollLeft && x < el.scrollLeft + visibleW) return;
    autoScrollingRef.current = true;
    el.scrollLeft = Math.max(0, x - visibleW * 0.1);
    requestAnimationFrame(() => { autoScrollingRef.current = false; });
  }, []);

  // Zoom appliqué : la ref suit, puis l'ancre Ctrl+molette est honorée
  useLayoutEffect(() => {
    zoomLevelRef.current = zoomLevel;
    const anchor = zoomAnchorRef.current;
    const el = timelineRef.current;
    if (anchor && el) {
      zoomAnchorRef.current = null;
      el.scrollLeft = anchor.time * zoomLevel - anchor.screenX;
    }
    syncPlayhead(lastTimeRef.current);
  }, [zoomLevel, syncPlayhead]);

  // Suivi de la tête en lecture : garde de geste + délai de grâce après un
  // scroll manuel. Le subscriber tourne à 60 Hz sans rendu React.
  useEffect(() => {
    const unsubscribe = subscribeToTime((time) => {
      syncPlayhead(time);
      if (!isPlayingRef.current || gestureActiveRef.current || isScrubbingRef.current) return;
      if (Date.now() - lastManualScrollAtRef.current < FOLLOW_GRACE_MS) return;
      revealTime(time);
    });
    return unsubscribe;
  }, [subscribeToTime, syncPlayhead, revealTime]);

  // En pause : ↑/↓, Début/Fin, clic marqueur… doivent montrer la tête. En
  // lecture, currentTime est throttlé : seul le subscriber positionne la tête.
  useEffect(() => {
    if (isPlaying) return;
    syncPlayhead(currentTime);
    if (gestureActiveRef.current || isScrubbingRef.current) return;
    revealTime(currentTime);
  }, [currentTime, isPlaying, syncPlayhead, revealTime]);

  // --- MESURE DU VIEWPORT (largeur du contenu adaptative) ---
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const measure = () => setViewportWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (activeTool !== 'cut') setCutHover(null);
    // Changer d'outil sort du mode multi-sélection
    setMultiSelectMode(false);
  }, [activeTool]);

  // Pistes affichées : text + video + audio en mode 'video', uniquement audio sinon.
  // Ordre : texte (haut), vidéo, audio (bas). Les pistes vidéo sont inversées :
  // la dernière de `tracks` est la couche du dessus (lecteur + export), elle
  // s'affiche donc juste sous la piste texte.
  const visibleTracks = useMemo(() => {
    const audio = tracks.filter(t => t.type === 'audio');
    if (currentView !== 'video') return audio;
    return [
      ...tracks.filter(t => t.type === 'text'),
      ...tracks.filter(t => t.type === 'video').reverse(),
      ...audio,
    ];
  }, [tracks, currentView]);
  const visibleTrackIds = useMemo(() => new Set(visibleTracks.map(t => t.id)), [visibleTracks]);

  // --- SNAPPING ---
  // Points : 0, tête de lecture, bords des clips des pistes affichées (hors
  // `excludeIds` = toute la sélection déplacée), marqueurs. `enabled` est
  // évalué à chaque move (inversion temporaire avec Ctrl/Cmd).
  const getSnappedPosition = useCallback((
    pos: number,
    excludeIds: ReadonlySet<string>,
    thresholdScreenPx = SNAP_THRESHOLD_PX,
    enabled = true,
  ) => {
    if (!enabled) return pos;
    let bestPos = pos;
    let minDiff = Math.min(thresholdScreenPx / zoomLevel, SNAP_MAX_SOURCE_PX);
    const snapPoints = [0, currentTimeRef.current, ...markers.map(m => m.time)];
    clips.forEach(c => {
      if (!excludeIds.has(c.id) && visibleTrackIds.has(c.track)) {
        snapPoints.push(c.start);
        snapPoints.push(c.start + c.width);
      }
    });
    snapPoints.forEach(point => {
      const diff = Math.abs(pos - point);
      if (diff < minDiff) {
        minDiff = diff;
        bestPos = point;
      }
    });
    return bestPos;
  }, [clips, markers, visibleTrackIds, currentTimeRef, zoomLevel]);

  const NO_EXCLUDE = useMemo(() => new Set<string>(), []);

  // --- SUPPRESSION (clavier, bouton X, toolbar) ---
  // « Annuler » n'appelle undo() que si la suppression est encore au sommet de
  // l'historique (undoIfTop) : après un drag intermédiaire, le clic ne fait rien
  // plutôt que d'annuler le drag. Les clips restaurés sont re-sélectionnés.
  const removeClips = useCallback((ids: string[]) => {
    const count = getClips().filter(c => ids.includes(c.id)).length;
    const token = deleteClips(ids);
    if (!token) return;
    toast({
      message: count > 1 ? `${count} clips supprimés` : 'Clip supprimé',
      type: 'info',
      action: {
        label: 'Annuler',
        onClick: () => { if (undoIfTop(token)) selectClips(ids); },
      },
    });
  }, [getClips, deleteClips, undoIfTop, selectClips, toast]);

  const removeClip = useCallback((id: string) => removeClips([id]), [removeClips]);

  // Suppression avec fermeture du trou (Maj+Suppr) : même schéma de toast
  const rippleRemoveClips = useCallback((ids: string[]) => {
    const count = getClips().filter(c => ids.includes(c.id)).length;
    const token = rippleDeleteClips(ids);
    if (!token) return;
    toast({
      message: count > 1 ? `${count} clips supprimés et refermés` : 'Clip supprimé et refermé',
      type: 'info',
      action: {
        label: 'Annuler',
        onClick: () => { if (undoIfTop(token)) selectClips(ids); },
      },
    });
  }, [getClips, rippleDeleteClips, undoIfTop, selectClips, toast]);

  // --- COUPER À LA TÊTE (Ctrl+B, bouton) ---
  // Temps lu dans la ref (currentTime est throttlé en lecture). Sans sélection :
  // tous les clips non verrouillés des pistes affichées. La sélection passe sur
  // les moitiés droites.
  const splitAtPlayhead = useCallback(() => {
    const t = currentTimeRef.current;
    let targets = selectedClipIds;
    if (targets.length === 0) {
      const allTracks = getTracks();
      const locked = new Set(allTracks.filter(tr => tr.locked).map(tr => tr.id));
      targets = getClips()
        .filter(c => visibleTrackIds.has(c.track) && !locked.has(c.track))
        .map(c => c.id);
    }
    const rightIds = splitClipsAt(targets, t);
    if (rightIds.length > 0) selectClips(rightIds);
  }, [currentTimeRef, selectedClipIds, getTracks, getClips, visibleTrackIds, splitClipsAt, selectClips]);

  // --- NAVIGATION : bord de clip précédent / suivant (↑ / ↓) ---
  const seek = useCallback((x: number) => {
    if (isPlayingRef.current) togglePlay();
    const next = Math.max(0, x);
    currentTimeRef.current = next;
    setCurrentTime(next);
  }, [togglePlay, currentTimeRef, setCurrentTime]);

  const jumpToEdge = useCallback((direction: 1 | -1) => {
    const edges = clipEdges(getClips(), visibleTrackIds);
    if (projectDurationPx > 0) edges.push(projectDurationPx);
    const t = currentTimeRef.current;
    let target: number | null = null;
    for (const edge of edges) {
      if (direction < 0 && edge < t - EPSILON && (target === null || edge > target)) target = edge;
      if (direction > 0 && edge > t + EPSILON && (target === null || edge < target)) target = edge;
    }
    if (target !== null) seek(target);
  }, [getClips, visibleTrackIds, projectDurationPx, currentTimeRef, seek]);

  // --- NUDGE (Alt+← / Alt+→) : sélection déplacée, refusé si chevauchement ---
  // setClips non discret : une rafale = une entrée d'historique (coalescence).
  const nudgeSelection = useCallback((deltaPx: number) => {
    if (selectedClipIds.length === 0) return;
    const all = getClips();
    const selected = all.filter(c => selectedClipIdSet.has(c.id));
    if (selected.length === 0) return;
    const minStart = Math.min(...selected.map(c => c.start));
    const delta = Math.max(deltaPx, -minStart);
    if (delta === 0) return;
    const conflict = selected.some(c => overlapsOnTrack(all, { ...c, start: c.start + delta }, selectedClipIdSet));
    if (conflict) {
      toast({ message: OCCUPIED_MESSAGE, type: 'warning', durationMs: 1500 });
      return;
    }
    setClips(prev => prev.map(c => selectedClipIdSet.has(c.id) ? { ...c, start: c.start + delta } : c));
  }, [selectedClipIds, selectedClipIdSet, getClips, setClips, toast]);

  // --- CLAVIER : un seul listener d'édition (voir §4.9 de la spec) ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') {
          if (e.repeat || e.shiftKey) return;
          e.preventDefault();
          splitAtPlayhead();
          return;
        }
        if (key === 'd') {
          e.preventDefault();
          if (selectedClipIds.length > 0) duplicateClips(selectedClipIds);
          return;
        }
        if (key === 'c') {
          // Copie dans l'ordre des clips (les écarts sont conservés au collage)
          const selected = clips.filter(c => selectedClipIdSet.has(c.id));
          if (selected.length > 0) clipboardRef.current = selected.map(c => ({ ...c }));
          return;
        }
        if (key === 'v') {
          if (clipboardRef.current.length === 0) return;
          e.preventDefault();
          pasteClips(clipboardRef.current, Math.max(0, currentTimeRef.current));
          return;
        }
        if (key === 'a') {
          e.preventDefault();
          selectAllClips();
          return;
        }
        return;
      }

      if (e.altKey && !mod) {
        // Nudge : une image, une seconde avec Maj
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const step = e.shiftKey ? PX_PER_SEC_BASE : PX_PER_SEC_BASE / fps;
          nudgeSelection(e.key === 'ArrowLeft' ? -step : step);
        }
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.length === 0) return;
        e.preventDefault();
        // Maj = ripple, testé avant la suppression simple
        if (e.shiftKey) rippleRemoveClips(selectedClipIds);
        else removeClips(selectedClipIds);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        jumpToEdge(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.key === 'Escape') {
        clearSelection();
        return;
      }
      if (e.repeat || e.shiftKey) return;
      if (e.key.toLowerCase() === 'n') {
        setSnapEnabled(!snapEnabled);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedClipIds, selectedClipIdSet, clips, fps, snapEnabled, togglePlay, duplicateClips, pasteClips,
    selectAllClips, removeClips, rippleRemoveClips, splitAtPlayhead, nudgeSelection, jumpToEdge,
    clearSelection, setSnapEnabled, currentTimeRef,
  ]);

  // --- ZOOM Ctrl+molette, centré sur le pointeur (bloque le zoom Chrome) ---
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY === 0) return;
        const rect = el.getBoundingClientRect();
        zoomAnchorRef.current = {
          time: timeFromClientX(e.clientX),
          screenX: e.clientX - rect.left - TRACK_HEADER_W,
        };
        const delta = -e.deltaY * 0.001;
        setZoomLevel(prev => clamp(prev + delta, ZOOM_MIN, ZOOM_MAX));
      }
    };
    el.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', handleWheelNative);
  }, [setZoomLevel, timeFromClientX]);

  // Scroll manuel : suspend le suivi de lecture pendant FOLLOW_GRACE_MS ;
  // le losange de la tête suit la zone visible.
  const handleScroll = () => {
    if (!autoScrollingRef.current) lastManualScrollAtRef.current = Date.now();
    syncPlayhead(lastTimeRef.current);
  };

  // --- COUPE (outil cutter : clic sur un clip = coupe à l'endroit cliqué) ---
  // Une seule entrée d'historique ; la moitié droite reprend la source au bon
  // endroit (offset). Ignoré sur une piste verrouillée ou trop près d'un bord.
  const handleClipClick = (e: ReactMouseEvent, clip: Clip) => {
    if (activeTool !== 'cut') return;
    e.stopPropagation();
    if (isClipLocked(clip, tracks)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = (e.clientX - rect.left) / zoomLevel;
    splitClipsAt([clip.id], clip.start + localX);
    setCutHover(null);
  };

  // --- APERÇU DE COUPE (ligne rouge sous le pointeur) ---
  const handleClipPointerMove = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip) => {
    if (activeTool !== 'cut') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCutHover({ clipId: clip.id, x: e.clientX - rect.left });
  };

  // Entrée/Espace sur un clip atteint au clavier (focus visible) : sélection.
  // Après un clic souris, Espace garde son sens global (lecture).
  const handleClipKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, clip: Clip) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!e.currentTarget.matches(':focus-visible')) return;
    e.preventDefault();
    e.stopPropagation();
    selectClip(clip.id, e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
  };

  const trimLabel = (start: number, end: number) =>
    `${formatTimecode(start, fps)} → ${formatTimecode(end, fps)} (${formatTimecode(end - start, fps)})`;

  // --- TRIM (Pointer Events : marche souris + touch + Apple Pencil) ---
  // Tout est calculé depuis les valeurs initiales capturées ici (jamais
  // `offset += delta`) ; le clamp aux bornes s'applique après l'aimantation.
  const handleTrim = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip, edge: 'start' | 'end') => {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    beginHistoryGesture();
    gestureActiveRef.current = true;
    setGestureClipIds(new Set([clip.id]));
    const startX = e.clientX;
    const initialWidth = clip.width;
    const initialStart = clip.start;
    const initialEnd = initialStart + initialWidth;
    const initialOffset = clip.offset ?? 0;
    const hasOffset = clip.type === 'video' || clip.type === 'audio';
    const bounds = trimBounds(getClips(), clip);
    const exclude = new Set([clip.id]);
    const snapPx = e.pointerType === 'touch' ? SNAP_THRESHOLD_TOUCH_PX : SNAP_THRESHOLD_PX;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = (moveEvent.clientX - startX) / zoomLevelRef.current;
      const snapOn = snapEnabledRef.current !== (moveEvent.ctrlKey || moveEvent.metaKey);
      if (edge === 'end') {
        const rawEnd = initialEnd + deltaX;
        const snapped = getSnappedPosition(rawEnd, exclude, snapPx, snapOn);
        const newEnd = clamp(snapped, bounds.minEnd, bounds.maxEnd);
        // Guide seulement si la valeur aimantée est celle retenue après clamp
        setSnapGuideX(snapped !== rawEnd && newEnd === snapped ? newEnd * zoomLevelRef.current : null);
        setGestureLabel({ x: newEnd * zoomLevelRef.current, text: trimLabel(initialStart, newEnd) });
        setClips(prev => prev.map(c =>
          c.id === clip.id ? { ...c, width: newEnd - initialStart } : c
        ));
      } else {
        const rawStart = initialStart + deltaX;
        const snapped = getSnappedPosition(rawStart, exclude, snapPx, snapOn);
        const newStart = clamp(snapped, bounds.minStart, bounds.maxStart);
        setSnapGuideX(snapped !== rawStart && newStart === snapped ? newStart * zoomLevelRef.current : null);
        setGestureLabel({ x: newStart * zoomLevelRef.current, text: trimLabel(newStart, initialEnd) });
        setClips(prev => prev.map(c => {
          if (c.id !== clip.id) return c;
          const next: Clip = { ...c, start: newStart, width: initialEnd - newStart };
          if (hasOffset) next.offset = initialOffset + (newStart - initialStart);
          return next;
        }));
      }
    };
    const onUp = () => {
      gestureActiveRef.current = false;
      endHistoryGesture();
      setSnapGuideX(null);
      setGestureLabel(null);
      setGestureClipIds(null);
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  // Rects des lignes de piste, mesurés au pointerdown (déplacement vertical)
  const measureTrackRects = (): TrackRect[] => {
    const el = timelineRef.current;
    if (!el) return [];
    return Array.from(el.querySelectorAll<HTMLElement>('[data-track-id]')).map(row => {
      const r = row.getBoundingClientRect();
      return {
        id: Number(row.dataset.trackId),
        type: row.dataset.trackType ?? '',
        locked: row.dataset.trackLocked === 'true',
        top: r.top,
        bottom: r.bottom,
      };
    });
  };

  // --- SÉLECTION + DÉPLACEMENT DES CLIPS (Pointer Events) ---
  // Mode au pointerdown : toggle (Ctrl/Cmd ou mode multi), range (Maj) — sans
  // capture ni geste ; keep (clip déjà sélectionné : le groupe est conservé) ou
  // replace, puis drag groupé. Un pointerup sans mouvement réduit au clip.
  const handleClipPointerDown = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip) => {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return;
    if (isClipLocked(clip, tracks)) return;
    e.preventDefault();

    // Maj ou Ctrl/Cmd maintenu = ajouter/retirer de la sélection (sans drag)
    const modKey = e.ctrlKey || e.metaKey || e.shiftKey;
    const mode: 'toggle' | 'keep' | 'replace' = modKey || multiSelectMode
      ? 'toggle'
      : selectedClipIdSet.has(clip.id) ? 'keep' : 'replace';
    if (mode === 'toggle') {
      selectClip(clip.id, 'toggle');
      return;
    }
    if (mode === 'replace') selectClip(clip.id, 'replace');
    const moving = mode === 'keep' ? selectedClipIds : [clip.id];
    const movingSet = new Set(moving);

    // Pas de capture sur l'élément : en déplacement vertical le clip change
    // de rangée DOM (démonté/remonté), les écouteurs vivent donc sur window.
    beginHistoryGesture();
    gestureActiveRef.current = true;
    setGestureClipIds(movingSet);

    const all = getClips();
    const byId = new Map(all.map(c => [c.id, c]));
    const initial = new Map(moving.flatMap(id => {
      const c = byId.get(id);
      return c ? [[id, { start: c.start, track: c.track }] as const] : [];
    }));
    const minInitial = Math.min(...[...initial.values()].map(v => v.start));
    const grabStart = clip.start;
    const grabEnd = clip.start + clip.width;
    const grabOffsetPx = timeFromClientX(e.clientX) - grabStart;
    const trackRects = measureTrackRects();
    const wantedType = clip.type === 'audio' ? 'audio' : 'video';
    const canMoveVertically = moving.length === 1 && clip.type !== 'text';
    const isTouch = e.pointerType === 'touch';
    const snapPx = isTouch ? SNAP_THRESHOLD_TOUCH_PX : SNAP_THRESHOLD_PX;
    const moveThreshold = isTouch ? MOVE_THRESHOLD_TOUCH_PX : MOVE_THRESHOLD_PX;

    let moved = false;
    let lastDelta = 0;
    let lastTrack = clip.track;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== e.pointerId) return;
      if (!moved) {
        const dx = Math.abs(moveEvent.clientX - startX);
        const dy = Math.abs(moveEvent.clientY - startY);
        if (dx < moveThreshold && dy < moveThreshold) return; // évite le drag accidentel sur tap
        moved = true;
      }
      const zoom = zoomLevelRef.current;
      const rawDelta = timeFromClientX(moveEvent.clientX) - grabOffsetPx - grabStart;
      // Borne 0 sur le clip le plus à gauche du groupe
      let delta = Math.max(rawDelta, -minInitial);
      const snapOn = snapEnabledRef.current !== (moveEvent.ctrlKey || moveEvent.metaKey);

      // Aimante le bord le plus proche du clip saisi (début ou fin), jamais sur
      // les clips de la sélection
      const rawStart = grabStart + delta;
      const rawEnd = grabEnd + delta;
      const snappedStart = getSnappedPosition(rawStart, movingSet, snapPx, snapOn);
      const snappedEnd = getSnappedPosition(rawEnd, movingSet, snapPx, snapOn);
      const startDiff = Math.abs(snappedStart - rawStart);
      const endDiff = Math.abs(snappedEnd - rawEnd);
      let guide: number | null = null;
      if (snappedStart !== rawStart && (snappedEnd === rawEnd || startDiff <= endDiff)) {
        delta = snappedStart - grabStart;
        guide = snappedStart;
      } else if (snappedEnd !== rawEnd) {
        delta = snappedEnd - grabEnd;
        guide = snappedEnd;
      }
      if (delta < -minInitial) {
        delta = -minInitial;
        guide = null;
      }

      // Vertical : clip seul, piste existante du même type, non verrouillée
      let targetTrack = initial.get(clip.id)?.track ?? clip.track;
      if (canMoveVertically) {
        const row = trackRects.find(r => moveEvent.clientY >= r.top && moveEvent.clientY < r.bottom);
        if (row && row.type === wantedType && !row.locked) targetTrack = row.id;
      }
      lastDelta = delta;
      lastTrack = targetTrack;

      setSnapGuideX(guide !== null ? guide * zoom : null);
      setGestureLabel({ x: (grabStart + delta) * zoom, text: formatTimecode(grabStart + delta, fps) });
      // Updater pur : toujours depuis les positions initiales
      setClips(prev => prev.map(c => {
        const init = initial.get(c.id);
        if (!init) return c;
        return { ...c, start: init.start + delta, track: c.id === clip.id ? targetTrack : init.track };
      }));
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== e.pointerId) return;
      gestureActiveRef.current = false;
      if (moved && lastDelta === 0 && lastTrack === clip.track) {
        // Bougé puis ramené au point de départ : pas d'entrée fantôme
        cancelHistoryGesture();
      } else if (moved) {
        // Refus de dépôt si un clip déplacé chevauche un clip hors sélection :
        // le geste est annulé sans entrée fantôme dans l'historique.
        const current = getClips();
        const conflict = moving.some(id => {
          const init = initial.get(id);
          const c = byId.get(id);
          if (!init || !c) return false;
          const movedClip: Clip = { ...c, start: init.start + lastDelta, track: id === clip.id ? lastTrack : init.track };
          return overlapsOnTrack(current, movedClip, movingSet);
        });
        if (conflict) {
          cancelHistoryGesture();
          toast({ message: OCCUPIED_MESSAGE, type: 'warning' });
        } else {
          endHistoryGesture();
        }
      } else {
        endHistoryGesture();
        // Tap/clic sans mouvement sur un clip du groupe : réduit au clip
        if (mode === 'keep') selectClip(clip.id, 'replace');
      }
      setGestureClipIds(null);
      setSnapGuideX(null);
      setGestureLabel(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // --- CRÉATION CLIP TEXTE (outil T) ---
  const handleAddTextClip = (clientX: number) => {
    const all = getClips();
    const textTrack = getTracks().find(t => t.id === textTrackId);
    if (textTrack?.locked) {
      toast({ message: 'Piste verrouillée', type: 'warning', durationMs: 1500 });
      return;
    }
    const x = Math.max(0, timeFromClientX(clientX));
    const snappedStart = getSnappedPosition(x, NO_EXCLUDE, SNAP_THRESHOLD_PX, snapEnabled);

    const newClip: Clip = {
      id: newId('text'),
      name: 'Nouveau texte',
      type: 'text',
      track: textTrackId,
      start: Math.max(0, snappedStart),
      width: 150,
      src: '',
      text: 'Votre texte ici',
      fontSize: 48,
      fontFamily: 'Arial',
      textColor: '#ffffff'
    };
    newClip.start = findFreeStart(all, newClip);

    setClips(prev => [...prev, newClip]);
    selectClip(newClip.id, 'replace');
    setActiveTool('select');
  };

  // Clic « dans le vide » : dans une ligne de piste (ou sur le conteneur
  // lui-même), hors clip et hors en-tête → désélection.
  const isEmptyAreaTarget = (e: ReactPointerEvent<HTMLDivElement>): boolean => {
    const t = e.target as Element;
    const onClip = !!t.closest('[data-clip-id]');
    const onHeader = !!t.closest('[data-track-header]');
    const inRows = t === e.currentTarget || !!t.closest('[data-track-id]');
    return inRows && !onClip && !onHeader;
  };

  // --- PAN HORIZONTAL (drag dans la zone des pistes, sous la règle) ---
  const handlePanPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (gestureClipIds) return;
    if (!timelineRef.current) return;
    const emptyArea = isEmptyAreaTarget(e);

    // Outil texte : on garde le comportement de création au clic
    if (activeTool === 'text') {
      if (emptyArea) handleAddTextClip(e.clientX);
      return;
    }

    // Désélectionne si on clique dans le vide (tactile compris)
    if (emptyArea) clearSelection();

    // Sur tactile, le navigateur gère déjà le pan nativement (plus fluide).
    // Notre handler ne sert que pour la souris et le stylet.
    if (e.pointerType === 'touch') return;

    const startX = e.clientX;
    const container = timelineRef.current;
    const startScroll = container.scrollLeft;

    const target = e.currentTarget;
    let panning = false;
    try { target.setPointerCapture(e.pointerId); } catch {}

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      // Active le pan dès qu'on bouge un peu (évite de bloquer un clic simple)
      if (!panning && Math.abs(dx) > 3) panning = true;
      if (panning) container.scrollLeft = startScroll - dx;
    };
    const onUp = () => {
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  // --- SCRUBBING (règle et losange de la tête, Pointer Events) ---
  const updateTimeFromCoord = (clientX: number) => {
    const next = Math.max(0, timeFromClientX(clientX));
    currentTimeRef.current = next;
    setCurrentTime(next);
  };

  const handleScrubPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // primary = left mouse / touch / pen tip — on rejette tout le reste
    if (e.button !== 0) return;
    if (gestureClipIds) return;

    if (activeTool === 'text') {
      handleAddTextClip(e.clientX);
      return;
    }

    // La règle est « du vide » : clic = désélection (sauf sur le losange)
    if (!(e.target as Element).closest('[data-playhead-handle]')) clearSelection();
    isScrubbingRef.current = true;
    gestureActiveRef.current = true;
    setIsScrubbing(true);
    updateTimeFromCoord(e.clientX);

    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch {}

    const onMove = (moveEvent: PointerEvent) => updateTimeFromCoord(moveEvent.clientX);
    const onUp = () => {
      isScrubbingRef.current = false;
      gestureActiveRef.current = false;
      setIsScrubbing(false);
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  // --- DRAG & DROP (HTML5 desktop) avec probe de durée ---
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  // Applique une durée réelle sondée à tous les clips issus de la source qui
  // ne la connaissent pas encore, HORS historique (Ctrl+Z après un dépôt retire
  // le clip, pas sa largeur). Le clip fraîchement déposé (largeur initiale
  // intacte) s'étire à sa durée, borné par le voisin de droite ; un clip déjà
  // trimé garde sa largeur, bornée par ce qui reste de source.
  const applyProbedDuration = useCallback((src: string, naturalPx: number, newClipId: string) => {
    setClipsWithoutHistory(prev => {
      let changed = false;
      const next = prev.map(c => {
        if (c.src !== src || c.sourceDuration != null || (c.type !== 'video' && c.type !== 'audio')) return c;
        changed = true;
        const untouched = c.id === newClipId && c.width === INITIAL_CLIP_WIDTH_PX && !c.offset;
        const nb = neighborBounds(prev, c);
        const width = untouched
          ? Math.min(naturalPx, nb.nextStart - c.start)
          : Math.min(c.width, naturalPx - (c.offset ?? 0));
        return { ...c, sourceDuration: naturalPx, width: Math.max(MIN_CLIP_WIDTH_PX, width) };
      });
      return changed ? next : prev;
    });
  }, [setClipsWithoutHistory]);

  /** Insère un média de la bibliothèque à la position (en px timeline) donnée. */
  const insertAsset = useCallback((asset: { name: string; type: string; src: string }, atPx: number) => {
    const isVideo = asset.type.startsWith('video');
    const isAudio = asset.type.startsWith('audio');
    const clipType: Clip['type'] = isVideo ? 'video' : isAudio ? 'audio' : 'image';
    const targetTrackType = isAudio ? 'audio' : 'video';

    // La vue musique masque les pistes vidéo : on bascule pour que le clip
    // déposé soit visible.
    if (targetTrackType === 'video' && currentView !== 'video') setCurrentView('video');

    // Piste (existante non verrouillée, sinon créée) + clip = une seule entrée
    // d'historique ; le clip est poussé à la première place libre.
    const id = newId('clip');
    insertClip({
      id,
      name: asset.name,
      type: clipType,
      start: Math.max(0, atPx),
      width: INITIAL_CLIP_WIDTH_PX,
      src: asset.src,
    }, targetTrackType);

    // Probe la durée naturelle pour étirer le clip à sa vraie durée
    if (isVideo || isAudio) {
      const cached = durationCacheRef.current.get(asset.src);
      if (cached != null) {
        applyProbedDuration(asset.src, cached, id);
        return;
      }
      probeMediaDuration(asset.src, isVideo ? 'video' : 'audio').then(duration => {
        if (!duration) return;
        const naturalPx = duration * PX_PER_SEC_BASE;
        durationCacheRef.current.set(asset.src, naturalPx);
        applyProbedDuration(asset.src, naturalPx, id);
      });
    }
  }, [insertClip, currentView, setCurrentView, applyProbedDuration]);

  // Position de dépôt : aimantée seulement si l'aimant est actif
  const dropPosition = useCallback((clientX: number, excludeIds: ReadonlySet<string>): number => {
    const x = Math.max(0, timeFromClientX(clientX));
    return Math.max(0, getSnappedPosition(x, excludeIds, SNAP_THRESHOLD_PX, snapEnabled));
  }, [timeFromClientX, getSnappedPosition, snapEnabled]);

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Safari n'expose pas toujours le type MIME personnalisé : fallback text/plain.
    const dataString = e.dataTransfer.getData("application/react-dnd")
      || e.dataTransfer.getData("text/plain");
    if (!dataString) return;
    let data: { isNew?: boolean; id?: string; name: string; type: string; src: string };
    try {
      data = JSON.parse(dataString);
    } catch {
      return; // texte quelconque déposé sur la timeline
    }
    if (!data || typeof data.type !== 'string' || typeof data.src !== 'string') return;

    if (data.isNew || !data.id) {
      insertAsset(data, dropPosition(e.clientX, NO_EXCLUDE));
      return;
    }
    // Clip existant : première place libre à partir du point de dépôt
    const id = data.id;
    const exclude = new Set([id]);
    const snappedStart = dropPosition(e.clientX, exclude);
    setClips(prev => {
      const clip = prev.find(c => c.id === id);
      if (!clip) return prev;
      const start = findFreeStart(prev, { ...clip, start: snappedStart }, exclude);
      return prev.map(c => c.id === id ? { ...c, start } : c);
    });
  };

  // Dépôt par Pointer Events depuis la bibliothèque (seul chemin qui marche sur
  // iPad et Safari, où le drag HTML5 est indisponible ou bloqué).
  useEffect(() => {
    const onDrop = (e: Event) => {
      const { name, type, src, clientX } = (e as CustomEvent<AssetDropPayload>).detail;
      insertAsset({ name, type, src }, dropPosition(clientX, NO_EXCLUDE));
    };
    const onAdd = (e: Event) => {
      const { name, type, src } = (e as CustomEvent<AssetAddPayload>).detail;
      insertAsset({ name, type, src }, Math.max(0, currentTimeRef.current));
    };
    window.addEventListener(ASSET_DROP_EVENT, onDrop);
    window.addEventListener(ASSET_ADD_EVENT, onAdd);
    return () => {
      window.removeEventListener(ASSET_DROP_EVENT, onDrop);
      window.removeEventListener(ASSET_ADD_EVENT, onAdd);
    };
  }, [insertAsset, dropPosition, NO_EXCLUDE, currentTimeRef]);

  // --- PISTE MICRO : l'enregistrement arrive directement sur la piste ---
  const handleMicRecorded = useCallback(async (trackId: number, rec: MicRecording, startPx: number) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const file = new File([rec.blob], `micro-${stamp}.${rec.extension}`, { type: rec.mimeType });
    try {
      const asset = await uploadAssetFile(file);
      setAssets(prev => [...prev, asset]);
      const seconds = await probeMediaDuration(asset.src, 'audio');
      const width = seconds ? Math.max(1, seconds * PX_PER_SEC_BASE) : INITIAL_CLIP_WIDTH_PX;
      insertClipOnTrack({
        id: newId('mic'), name: file.name, type: 'audio', src: asset.src,
        start: Math.max(0, startPx), width, sourceDuration: seconds ? width : undefined,
      }, trackId);
      toast({ type: 'success', message: 'Enregistrement placé sur la piste Micro' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      console.error('[fullcrea] Enregistrement micro non sauvegardé', e);
      toast({ type: 'error', message: `Enregistrement non sauvegardé : ${msg}` });
    }
  }, [uploadAssetFile, setAssets, insertClipOnTrack, toast]);

  // --- STYLES & FILTRES ---
  const getClipStyle = useCallback((type: string) => {
    if (type === 'sequence') return "bg-indigo-600/40 border-indigo-400 text-indigo-100";
    if (type === 'audio') return "bg-green-600/40 border-green-500 text-green-100";
    if (type === 'image') return "bg-purple-600/40 border-purple-500 text-purple-100";
    if (type === 'text') return "bg-yellow-600/40 border-yellow-500 text-yellow-100";
    return "bg-blue-600/40 border-blue-500 text-blue-100";
  }, []);

  const getClipLabel = (clip: Clip) => {
    if (clip.type !== 'text') return clip.name;
    const text = (clip.text ?? '').replace(/\s+/g, ' ').trim();
    return text || clip.name;
  };

  const getClipTitle = (clip: Clip) =>
    (clip.tts ? 'Double-clic pour modifier le texte — ' : '') +
    (clip.type === 'sequence' ? 'Timeline imbriquée, double-clic pour l\'ouvrir — ' : '') +
    `${getClipLabel(clip)} — ${formatPx(clip.start)} → ${formatPx(clip.start + clip.width)} (${formatPx(clip.width)})`;

  // Quels clips appartiennent à quelle piste — filtre par type-cohérence
  const clipsForTrack = useCallback((track: { id: number; type: string }) => {
    if (track.type === 'text') return clips.filter(c => c.type === 'text');
    return clips.filter(c => c.type !== 'text' && c.track === track.id);
  }, [clips]);

  // --- RÈGLE ADAPTATIVE ---
  const rulerMarks = useMemo(() => {
    const pxPerSec = PX_PER_SEC_BASE * zoomLevel;
    const majorSec = pickMajorIntervalSec(zoomLevel);
    const majorPx = majorSec * pxPerSec;
    const minorSec = majorSec / 5;
    const minorPx = minorSec * pxPerSec;
    const showMinor = minorPx >= RULER_MINOR_MIN_GAP_PX;
    const majorCount = Math.ceil(contentWidth / majorPx) + 1;
    const marks: ReactNode[] = [];

    for (let i = 0; i < majorCount; i++) {
      const left = i * majorPx;
      marks.push(
        <div
          key={`M${i}`}
          className="absolute bottom-0 border-l border-gray-700 h-2 pl-1 text-[10px] text-gray-500 whitespace-nowrap pointer-events-none"
          style={{ left }}
        >
          {formatSeconds(i * majorSec)}
        </div>
      );
      if (showMinor) {
        for (let j = 1; j < 5; j++) {
          marks.push(
            <div
              key={`m${i}_${j}`}
              className="absolute bottom-0 border-l border-gray-800 h-1 pointer-events-none"
              style={{ left: left + j * minorPx }}
            />
          );
        }
      }
    }
    return marks;
  }, [zoomLevel, contentWidth]);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-300 border-t border-gray-700 select-none">
      <TimelineToolbar
        onDeleteClips={removeClips}
        onRippleDeleteClips={rippleRemoveClips}
        onSplit={splitAtPlayhead}
        multiSelectMode={multiSelectMode}
        onToggleMulti={() => setMultiSelectMode(v => !v)}
      />
      <div
        ref={timelineRef}
        className={`timeline-container flex-1 overflow-x-auto overflow-y-auto relative custom-scrollbar ${isScrubbing ? 'cursor-grabbing' : 'cursor-default'}`}
        style={{ touchAction: 'pan-x pan-y' }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPointerDown={handlePanPointerDown}
        onScroll={handleScroll}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* RÈGLE — clic ici déplace la tête de lecture */}
        <div
          className="h-6 bg-gray-950 sticky top-0 border-b border-gray-800 z-30 cursor-ew-resize"
          style={{ touchAction: 'none', minWidth: rowWidth }}
          onPointerDown={(e) => { e.stopPropagation(); handleScrubPointerDown(e); }}
        >
          {/* Graduations, décalées de la gouttière */}
          <div className="absolute inset-y-0 right-0" style={{ left: TRACK_HEADER_W }}>
            {rulerMarks}
            {projectDurationPx > 0 && (
              <div
                className="absolute top-0 bottom-0 border-l border-dashed border-gray-600 pl-1 pt-0.5 text-[10px] text-gray-500 pointer-events-none"
                style={{ left: projectEndX }}
              >
                Fin
              </div>
            )}
          </div>
          {/* Coin de la gouttière : masque les graduations qui défilent dessous */}
          <div className="sticky left-0 h-full bg-gray-950 border-r border-gray-700 z-10" style={{ width: TRACK_HEADER_W }} />
          {/* Losange de la tête de lecture (zone saisissable) */}
          <div
            ref={playheadHandleRef}
            data-playhead-handle=""
            className="absolute top-0 left-0 h-full w-4 -ml-2 z-20 flex justify-center group"
            style={{ transform: `translateX(${TRACK_HEADER_W + currentTime * zoomLevel}px)`, willChange: 'transform' }}
          >
            <div className="absolute top-0 w-3 h-3 bg-red-500 rotate-45 -mt-1.5 transform group-hover:scale-125 transition-transform" />
            <div className="w-px h-full bg-red-500" />
          </div>
        </div>

        {/* ZONE DES PISTES (contexte d'empilement propre : reste sous la règle) */}
        <div
          className="relative z-0"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Clips de la timeline"
          data-shortcuts-passthrough=""
        >
          {/* Tête de lecture : trait seul, non saisissable dans les pistes */}
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 left-0 w-px bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)] z-[35] pointer-events-none"
            style={{ transform: `translateX(${TRACK_HEADER_W + currentTime * zoomLevel}px)`, willChange: 'transform' }}
          />

          {/* Marqueur de fin de projet */}
          {projectDurationPx > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px border-l border-dashed border-gray-600/70 z-10 pointer-events-none"
              style={{ left: TRACK_HEADER_W + projectEndX }}
            />
          )}

          {/* Guide d'aimantation */}
          {snapGuideX !== null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-cyan-400/80 z-[35] pointer-events-none"
              style={{ left: TRACK_HEADER_W + snapGuideX }}
            />
          )}

          {/* Tooltip de timecode pendant un drag/trim */}
          {gestureLabel && (
            <div
              className="absolute top-1 -translate-x-1/2 z-50 pointer-events-none px-1.5 py-0.5 rounded bg-cyan-500 text-black text-[10px] font-mono whitespace-nowrap shadow"
              style={{ left: TRACK_HEADER_W + gestureLabel.x }}
              data-gesture-label=""
            >
              {gestureLabel.text}
            </div>
          )}

          {/* État vide */}
          {clips.length === 0 && (
            <div className="absolute inset-0 z-30 pointer-events-none">
              <div
                className="sticky left-0 h-full flex flex-col items-center justify-center gap-1 text-gray-600 text-xs text-center"
                style={{ width: viewportWidth || '100%', paddingLeft: TRACK_HEADER_W }}
              >
                <MousePointerClick size={18} className="mb-1 opacity-70" />
                <span>Glissez un média depuis la bibliothèque</span>
                <span>ou appuyez sur T puis cliquez sur la timeline pour ajouter un texte</span>
              </div>
            </div>
          )}

          {/* PISTES */}
          {visibleTracks.map(track => {
            const isText = track.type === 'text';
            const trackHeight = isText ? 'h-12' : 'h-24';
            const labelBg = isText
              ? 'bg-yellow-900/30 text-yellow-400'
              : track.type === 'video'
                ? 'bg-blue-900/30 text-blue-400'
                : track.kind === 'voiceover'
                  ? 'bg-emerald-900/30 text-emerald-300'
                  : track.kind === 'music'
                    ? 'bg-purple-900/30 text-purple-300'
                    : track.kind === 'mic'
                      ? 'bg-red-900/30 text-red-300'
                      : 'bg-green-900/30 text-green-400';
            const locked = !!track.locked;
            return (
              <div
                key={track.id}
                data-track-id={track.id}
                data-track-type={track.type}
                data-track-locked={locked ? 'true' : 'false'}
                className={`${trackHeight} bg-gray-900/50 border-b border-gray-800 relative my-1`}
                style={{
                  minWidth: rowWidth,
                  // Piste verrouillée : fond hachuré
                  backgroundImage: locked
                    ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 6px, transparent 6px, transparent 14px)'
                    : undefined,
                }}
              >
                {/* En-tête (gouttière), hors du contenu */}
                <TrackHeader
                  track={track}
                  width={TRACK_HEADER_W}
                  className={labelBg}
                  onAddVoiceOver={() => setVoiceOverEditor({ trackId: track.id })}
                  onAddMusic={() => setMusicPickerTrack(track.id)}
                  getMicStartPx={() => currentTimeRef.current}
                  onMicRecorded={(rec, startPx) => handleMicRecorded(track.id, rec, startPx)}
                  onMicError={(message) => toast({ type: 'error', message })}
                />
                {/* Lane : porte les clips, left = clip.start × zoom */}
                <div className="absolute inset-y-0 right-0" style={{ left: TRACK_HEADER_W }}>
                {clipsForTrack(track).map(clip => {
                  const screenW = clip.width * zoomLevel;
                  const inGesture = !!gestureClipIds?.has(clip.id);
                  const isSelected = selectedClipIdSet.has(clip.id);
                  const showHandles = activeTool === 'select' && !locked && screenW >= HANDLES_MIN_CLIP_SCREEN_PX;
                  const handleW = Math.max(HANDLE_MIN_W_PX, Math.min(HANDLE_MAX_W_PX, screenW / 3));
                  return (
                  <div
                    key={clip.id}
                    data-clip-id={clip.id}
                    title={getClipTitle(clip)}
                    role="option"
                    aria-selected={isSelected}
                    aria-label={getClipTitle(clip)}
                    tabIndex={0}
                    className={`absolute top-1 bottom-1 rounded border overflow-hidden flex items-center px-2 text-xs group focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300
                      ${inGesture ? 'transition-none opacity-80 z-30' : 'transition-all duration-150'}
                      ${getClipStyle(clip.type)}
                      ${locked ? 'cursor-not-allowed opacity-70' : activeTool === 'cut' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}
                      ${isSelected ? 'ring-2 ring-white border-white z-20 shadow-[0_0_15px_rgba(255,255,255,0.3)]' : 'hover:shadow-lg hover:shadow-white/5'}
                    `}
                    style={{
                      left: `${clip.start * zoomLevel}px`,
                      width: `${screenW}px`,
                      minWidth: 2,
                      touchAction: 'none', // permet au pointermove tactile sans interférence du scroll
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleClipPointerDown(e, clip);
                    }}
                    onPointerMove={(e) => handleClipPointerMove(e, clip)}
                    onPointerLeave={() => { if (activeTool === 'cut') setCutHover(null); }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClipClick(e, clip);
                    }}
                    onDoubleClick={(e) => {
                      if (locked) return;
                      // Timeline imbriquée : double-clic = l'ouvrir
                      if (clip.type === 'sequence' && clip.sequenceRef) {
                        e.stopPropagation();
                        selectSequence(clip.sequenceRef);
                        return;
                      }
                      // Voix off générée : double-clic = modifier le texte et régénérer
                      if (!clip.tts) return;
                      e.stopPropagation();
                      setVoiceOverEditor({ trackId: clip.track, clip });
                    }}
                    onKeyDown={(e) => handleClipKeyDown(e, clip)}
                  >
                    {showHandles && (
                      <>
                        {/* Trim handles : zone tactile de 14px (≈ pouce iPad), réduite sur les clips étroits */}
                        <div
                          data-trim-handle="start"
                          className="absolute left-0 top-0 bottom-0 cursor-ew-resize hover:bg-white/30 z-10 touch-none"
                          style={{ touchAction: 'none', width: handleW }}
                          onPointerDown={(e) => handleTrim(e, clip, 'start')}
                        />
                        <div
                          data-trim-handle="end"
                          className="absolute right-0 top-0 bottom-0 cursor-ew-resize hover:bg-white/30 z-10 touch-none"
                          style={{ touchAction: 'none', width: handleW }}
                          onPointerDown={(e) => handleTrim(e, clip, 'end')}
                        />
                      </>
                    )}
                    {activeTool === 'cut' && cutHover?.clipId === clip.id && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none"
                        style={{ left: cutHover.x }}
                      />
                    )}
                    {clip.type === 'audio' && clip.src && (
                      <AudioWaveform
                        src={clip.src}
                        durationSeconds={clip.width / PX_PER_SEC_BASE}
                        offsetSeconds={(clip.offset ?? 0) / PX_PER_SEC_BASE}
                      />
                    )}
                    {/* Vidéo : sa bande son s'affiche en bas du clip (bandeau sombre) */}
                    {clip.type === 'video' && clip.src && (
                      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-black/30 pointer-events-none">
                        <AudioWaveform
                          src={clip.src}
                          durationSeconds={clip.width / PX_PER_SEC_BASE}
                          offsetSeconds={(clip.offset ?? 0) / PX_PER_SEC_BASE}
                          color="rgba(191, 219, 254, 0.9)"
                        />
                      </div>
                    )}
                    <div className="relative z-[1] flex items-center min-w-0 w-full">
                      {clip.type === 'sequence' && <Film size={12} className="mr-2 shrink-0 opacity-80" aria-label="Timeline imbriquée — double-clic pour l'ouvrir" />}
                      {clip.type === 'audio' && (clip.tts
                        ? <MessageSquareText size={12} className="mr-2 shrink-0 opacity-80" aria-label="Voix off générée — double-clic pour modifier" />
                        : <Music size={12} className="mr-2 shrink-0 opacity-70" />)}
                      {clip.type === 'text' && <Type size={12} className="mr-2 shrink-0 opacity-50" />}
                      <span className="truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">{getClipLabel(clip)}</span>
                    </div>

                    {/* Bouton de suppression (X rouge en haut à droite) */}
                    {!locked && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeClip(clip.id);
                        }}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-red-600/90 hover:bg-red-500 text-white flex items-center justify-center z-30 shadow-md transition-transform active:scale-90 focus:outline-none focus:ring-2 focus:ring-red-400"
                        style={{ touchAction: 'manipulation' }}
                        title="Supprimer ce média"
                        aria-label="Supprimer ce média"
                      >
                        <X size={11} strokeWidth={3} />
                      </button>
                    )}
                  </div>
                  );
                })}
                </div>
              </div>
            );
          })}

          {/* Boutons d'ajout de pistes (stopPropagation : pas de pan ni de texte) */}
          <div
            className="flex items-center gap-2 p-2"
            style={{ minWidth: rowWidth, paddingLeft: TRACK_HEADER_W }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => addTrack('video')}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded border border-blue-600/30 transition-all"
              title="Ajouter une piste vidéo"
            >
              <Plus size={14} />
              <Video size={14} />
              <span>Piste Vidéo</span>
            </button>
            <button
              onClick={() => addTrack('audio')}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded border border-green-600/30 transition-all"
              title="Ajouter une piste audio"
            >
              <Plus size={14} />
              <AudioLines size={14} />
              <span>Piste Audio</span>
            </button>
          </div>
        </div>
      </div>

      {voiceOverEditor && (
        <VoiceOverModal
          trackId={voiceOverEditor.trackId}
          clip={voiceOverEditor.clip}
          onClose={() => setVoiceOverEditor(null)}
        />
      )}
      {musicPickerTrack !== null && (
        <MusicPickerModal trackId={musicPickerTrack} onClose={() => setMusicPickerTrack(null)} />
      )}
    </div>
  );
}
