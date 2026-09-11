"use client";

import { shouldIgnoreShortcut } from '@/lib/keyboard';
import { useRef, DragEvent, useState, useEffect, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, useCallback, useMemo, type ReactNode } from 'react';
import { Music, Plus, Video, AudioLines, Type, X, MousePointerClick } from 'lucide-react';
import { useProject, Clip } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import TimelineToolbar from './TimelineToolbar';
import AudioWaveform from './AudioWaveform';
import {
  ASSET_ADD_EVENT,
  ASSET_DROP_EVENT,
  type AssetAddPayload,
  type AssetDropPayload,
} from '@/lib/assetDrag';

const PX_PER_SEC_BASE = 30;
const SNAP_THRESHOLD_PX = 10;
const SNAP_THRESHOLD_TOUCH_PX = 14;
const RULER_MAJOR_INTERVALS_SEC = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const RULER_MAJOR_MIN_GAP_PX = 90;
const RULER_MINOR_MIN_GAP_PX = 12;
const CONTENT_MIN_MARGIN_PX = 400;
const CONTENT_END_MARGIN_PX = 600;

function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatPx(px: number): string {
  return formatSeconds(px / PX_PER_SEC_BASE);
}

function pickMajorIntervalSec(zoomLevel: number): number {
  const pxPerSec = PX_PER_SEC_BASE * zoomLevel;
  return RULER_MAJOR_INTERVALS_SEC.find(sec => sec * pxPerSec >= RULER_MAJOR_MIN_GAP_PX)
    ?? RULER_MAJOR_INTERVALS_SEC[RULER_MAJOR_INTERVALS_SEC.length - 1];
}

// --- Probe asynchrone de la durée d'un média ---
function probeMediaDuration(src: string, kind: 'video' | 'audio'): Promise<number | null> {
  return new Promise((resolve) => {
    const el = (kind === 'video' ? document.createElement('video') : document.createElement('audio')) as HTMLMediaElement;
    el.preload = 'metadata';
    el.muted = true;
    let done = false;
    const finish = (val: number | null) => {
      if (done) return;
      done = true;
      el.src = '';
      try { el.removeAttribute('src'); el.load(); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 8000);
    el.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      const d = el.duration;
      finish(isFinite(d) && d > 0 ? d : null);
    }, { once: true });
    el.addEventListener('error', () => { clearTimeout(timer); finish(null); }, { once: true });
    try { el.src = src; } catch { finish(null); }
  });
}

export default function Timeline() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const clipboardRef = useRef<Clip | null>(null);

  const {
    clips,
    setClips,
    deleteClip,
    duplicateClip,
    beginHistoryGesture,
    endHistoryGesture,
    projectDurationPx,
    currentProjectId,
    currentTime,
    setCurrentTime,
    currentView,
    setCurrentView,
    activeTool,
    setActiveTool,
    zoomLevel,
    setZoomLevel,
    selectedClipId,
    setSelectedClipId,
    togglePlay,
    subscribeToTime,
    currentTimeRef,
    tracks,
    addTrack,
    ensureTrack,
    textTrackId,
  } = useProject();
  const { toast } = useToast();

  const clipsRef = useRef(clips);
  const currentProjectIdRef = useRef(currentProjectId);

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [snapGuideX, setSnapGuideX] = useState<number | null>(null);
  const [cutHover, setCutHover] = useState<{ clipId: string; x: number } | null>(null);

  const contentWidth = Math.max(
    viewportWidth + CONTENT_MIN_MARGIN_PX,
    projectDurationPx * zoomLevel + CONTENT_END_MARGIN_PX
  );
  const projectEndX = projectDurationPx * zoomLevel;

  useEffect(() => {
    const unsubscribe = subscribeToTime((time) => {
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${time * zoomLevel}px)`;
      }
    });
    return unsubscribe;
  }, [subscribeToTime, zoomLevel]);

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
  }, [activeTool]);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  // --- SNAPPING ---
  const getSnappedPosition = useCallback((pos: number, excludeId?: string, thresholdScreenPx = SNAP_THRESHOLD_PX) => {
    let bestPos = pos;
    let minDiff = thresholdScreenPx / zoomLevel;
    const snapPoints = [currentTimeRef.current];
    clips.forEach(c => {
      if (c.id !== excludeId) {
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
  }, [clips, currentTimeRef, zoomLevel]);

  // --- SUPPRESSION (clavier + bouton X) ---
  // « Annuler » restaure le clip capturé plutôt que d'appeler undo(), qui
  // annulerait la dernière action quelle qu'elle soit (drag, trim, collage…).
  // Le clic est ignoré si le projet a changé entre-temps ou si le clip est déjà
  // revenu (Ctrl+Z) : un setClips redondant polluerait l'historique et viderait le redo.
  const removeClip = useCallback((id: string) => {
    const clip = clipsRef.current.find(c => c.id === id);
    if (!clip) return;
    const projectId = currentProjectId;
    deleteClip(id);
    toast({
      message: 'Clip supprimé',
      type: 'info',
      action: {
        label: 'Annuler',
        onClick: () => {
          if (currentProjectIdRef.current !== projectId) return;
          if (clipsRef.current.some(c => c.id === clip.id)) return;
          setClips(prev => prev.some(c => c.id === clip.id) ? prev : [...prev, clip]);
          setSelectedClipId(clip.id);
        },
      },
    });
  }, [currentProjectId, deleteClip, setClips, setSelectedClipId, toast]);

  // --- CLAVIER : Suppression, Play/Pause, Dupliquer, Copier/Coller ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'd') {
          e.preventDefault();
          if (selectedClipId) duplicateClip(selectedClipId);
          return;
        }
        if (key === 'c') {
          const clip = selectedClipId ? clips.find(c => c.id === selectedClipId) : undefined;
          if (clip) clipboardRef.current = { ...clip };
          return;
        }
        if (key === 'v') {
          const copied = clipboardRef.current;
          if (!copied) return;
          e.preventDefault();
          const pasted: Clip = {
            ...copied,
            id: `${copied.id}_paste_${Date.now()}`,
            start: Math.max(0, currentTimeRef.current),
          };
          if (copied.transform) pasted.transform = { ...copied.transform };
          setClips(prev => [...prev, pasted]);
          setSelectedClipId(pasted.id);
          return;
        }
        if (key === 'a') {
          e.preventDefault();
          return;
        }
        return;
      }

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipId) {
        e.preventDefault();
        removeClip(selectedClipId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, clips, setClips, setSelectedClipId, togglePlay, duplicateClip, removeClip, currentTimeRef]);

  // --- BLOCAGE ZOOM CHROME ---
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handleWheelNative = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = -e.deltaY * 0.001;
        setZoomLevel(prev => Math.min(Math.max(0.1, prev + delta), 10));
      }
    };
    el.addEventListener('wheel', handleWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', handleWheelNative);
  }, [setZoomLevel]);

  // --- COUPE ---
  const handleClipClick = (e: ReactMouseEvent, clip: Clip) => {
    if (activeTool !== 'cut') return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const cutPointX = (e.clientX - rect.left) / zoomLevel;
    const clipA: Clip = { ...clip, width: cutPointX, id: `${clip.id}_p1_${Date.now()}` };
    const clipB: Clip = { ...clip, id: `${clip.id}_p2_${Date.now()}`, start: clip.start + cutPointX, width: clip.width - cutPointX };
    setClips(prev => [...prev.filter(c => c.id !== clip.id), clipA, clipB]);
    setSelectedClipId(null);
    setCutHover(null);
  };

  // --- APERÇU DE COUPE (ligne rouge sous le pointeur) ---
  const handleClipPointerMove = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip) => {
    if (activeTool !== 'cut') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setCutHover({ clipId: clip.id, x: e.clientX - rect.left });
  };

  // --- TRIM (Pointer Events : marche souris + touch + Apple Pencil) ---
  const handleTrim = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip, edge: 'start' | 'end') => {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    beginHistoryGesture();
    const startX = e.clientX;
    const initialWidth = clip.width;
    const initialStart = clip.start;
    const snapPx = e.pointerType === 'touch' ? SNAP_THRESHOLD_TOUCH_PX : SNAP_THRESHOLD_PX;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = (moveEvent.clientX - startX) / zoomLevel;
      if (edge === 'end') {
        const rawEnd = initialStart + initialWidth + deltaX;
        const newEnd = getSnappedPosition(rawEnd, clip.id, snapPx);
        setSnapGuideX(newEnd !== rawEnd ? newEnd * zoomLevel : null);
        setClips(prev => prev.map(c =>
          c.id === clip.id ? { ...c, width: Math.max(5, newEnd - initialStart) } : c
        ));
      } else {
        const rawStart = initialStart + deltaX;
        const newStart = getSnappedPosition(rawStart, clip.id, snapPx);
        const newWidth = initialStart + initialWidth - newStart;
        setSnapGuideX(newStart !== rawStart && newWidth > 5 ? newStart * zoomLevel : null);
        setClips(prev => prev.map(c =>
          c.id === clip.id && newWidth > 5 ? { ...c, start: newStart, width: newWidth } : c
        ));
      }
    };
    const onUp = () => {
      endHistoryGesture();
      setSnapGuideX(null);
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  // --- DÉPLACEMENT DES CLIPS (Pointer Events) ---
  const handleClipPointerDown = (e: ReactPointerEvent<HTMLDivElement>, clip: Clip) => {
    if (activeTool !== 'select') return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    beginHistoryGesture();

    const rect = target.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    setSelectedClipId(clip.id);
    setDraggingClipId(clip.id);

    let moved = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const snapPx = e.pointerType === 'touch' ? SNAP_THRESHOLD_TOUCH_PX : SNAP_THRESHOLD_PX;

    const onMove = (moveEvent: PointerEvent) => {
      if (!timelineRef.current) return;
      if (!moved) {
        const dx = Math.abs(moveEvent.clientX - startX);
        const dy = Math.abs(moveEvent.clientY - startY);
        if (dx < 3 && dy < 3) return; // seuil de mouvement (évite le drag accidentel sur tap)
        moved = true;
      }
      const timelineRect = timelineRef.current.getBoundingClientRect();
      const x = ((moveEvent.clientX - timelineRect.left) + timelineRef.current.scrollLeft - offsetX) / zoomLevel;
      const rawStart = Math.max(0, x);
      const rawEnd = rawStart + clip.width;

      // Aimante le bord le plus proche d'un point de snap (début ou fin du clip)
      const snappedStart = getSnappedPosition(rawStart, clip.id, snapPx);
      const snappedEnd = getSnappedPosition(rawEnd, clip.id, snapPx);
      const startDiff = Math.abs(snappedStart - rawStart);
      const endDiff = Math.abs(snappedEnd - rawEnd);
      let newStart = rawStart;
      let guide: number | null = null;
      if (snappedStart !== rawStart && (snappedEnd === rawEnd || startDiff <= endDiff)) {
        newStart = snappedStart;
        guide = snappedStart;
      } else if (snappedEnd !== rawEnd && snappedEnd - clip.width >= 0) {
        newStart = snappedEnd - clip.width;
        guide = snappedEnd;
      }
      setSnapGuideX(guide !== null ? guide * zoomLevel : null);
      setClips(prev => prev.map(c =>
        c.id === clip.id ? { ...c, start: newStart } : c
      ));
    };
    const onUp = () => {
      endHistoryGesture();
      setDraggingClipId(null);
      setSnapGuideX(null);
      try { target.releasePointerCapture(e.pointerId); } catch {}
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  // --- CRÉATION CLIP TEXTE ---
  const handleAddTextClip = (clientX: number) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) + timelineRef.current.scrollLeft) / zoomLevel;
    const snappedStart = getSnappedPosition(x);

    const newClip: Clip = {
      id: `text_${Date.now()}`,
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

    setClips(prev => [...prev, newClip]);
    setSelectedClipId(newClip.id);
    setActiveTool('select');
  };

  // --- PAN HORIZONTAL (drag dans la zone des pistes, sous la règle) ---
  const handlePanPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (draggingClipId) return;
    if (!timelineRef.current) return;

    // Sur tactile, le navigateur gère déjà le pan-x nativement (plus fluide).
    // Notre handler ne sert que pour la souris et le stylet.
    if (e.pointerType === 'touch') return;

    // Outil texte : on garde le comportement de création au clic
    if (activeTool === 'text') {
      handleAddTextClip(e.clientX);
      return;
    }

    // Désélectionne le clip si on clique dans le vide
    if (e.target === e.currentTarget) setSelectedClipId(null);

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

  // --- SCRUBBING (Pointer Events) ---
  const handleScrubPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // primary = left mouse / touch / pen tip — on rejette tout le reste
    if (e.button !== 0) return;
    if (draggingClipId) return;

    if (activeTool === 'text') {
      handleAddTextClip(e.clientX);
      return;
    }

    if (e.target === e.currentTarget) setSelectedClipId(null);
    setIsScrubbing(true);
    updateTimeFromCoord(e.clientX);

    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch {}

    const onMove = (moveEvent: PointerEvent) => updateTimeFromCoord(moveEvent.clientX);
    const onUp = () => {
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
  const updateTimeFromCoord = (clientX: number) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = ((clientX - rect.left) + timelineRef.current.scrollLeft) / zoomLevel;
    setCurrentTime(Math.max(0, x));
  };

  // --- DRAG & DROP (HTML5 desktop) avec probe de durée ---
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  /** Insère un média de la bibliothèque à la position (en px timeline) donnée. */
  const insertAsset = useCallback((asset: { name: string; type: string; src: string }, atPx: number) => {
    const isVideo = asset.type.startsWith('video');
    const isAudio = asset.type.startsWith('audio');
    const clipType: Clip['type'] = isVideo ? 'video' : isAudio ? 'audio' : 'image';

    // Choisir une piste valide qui correspond au type. Les projets sans piste
    // du bon type (anciens projets, ou piste supprimée) en reçoivent une.
    const targetTrackType = isAudio ? 'audio' : 'video';
    const targetTrackId = ensureTrack(targetTrackType);

    // La vue musique masque les pistes vidéo : on bascule pour que le clip
    // déposé soit visible.
    if (targetTrackType === 'video' && currentView !== 'video') setCurrentView('video');

    const newId = `clip_${Date.now()}`;
    const initialWidth = 150;
    const newClip: Clip = {
      id: newId,
      name: asset.name,
      type: clipType,
      track: targetTrackId,
      start: Math.max(0, atPx),
      width: initialWidth,
      src: asset.src,
    };
    setClips(prev => [...prev, newClip]);
    setSelectedClipId(newId);

    // Probe la durée naturelle pour étirer le clip à sa vraie durée
    if (isVideo || isAudio) {
      probeMediaDuration(asset.src, isVideo ? 'video' : 'audio').then(duration => {
        if (!duration) return;
        const naturalWidth = duration * PX_PER_SEC_BASE;
        setClips(prev => prev.map(c =>
          c.id === newId ? { ...c, width: naturalWidth } : c
        ));
      });
    }
  }, [ensureTrack, currentView, setCurrentView, setClips, setSelectedClipId]);

  /** Convertit une abscisse viewport en position (px) sur la timeline. */
  const timelinePosFromClientX = useCallback((clientX: number): number | null => {
    const el = timelineRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return ((clientX - rect.left) + el.scrollLeft) / zoomLevel;
  }, [zoomLevel]);

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropX = timelinePosFromClientX(e.clientX);
    if (dropX === null) return;
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

    const snappedStart = getSnappedPosition(dropX, data.isNew ? undefined : data.id);

    if (data.isNew) {
      insertAsset(data, snappedStart);
    } else {
      setClips(prev => prev.map(c => c.id === data.id ? { ...c, start: Math.max(0, snappedStart) } : c));
    }
  };

  // Dépôt par Pointer Events depuis la bibliothèque (seul chemin qui marche sur
  // iPad et Safari, où le drag HTML5 est indisponible ou bloqué).
  useEffect(() => {
    const onDrop = (e: Event) => {
      const { name, type, src, clientX } = (e as CustomEvent<AssetDropPayload>).detail;
      const dropX = timelinePosFromClientX(clientX);
      if (dropX === null) return;
      insertAsset({ name, type, src }, getSnappedPosition(dropX));
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
  }, [insertAsset, timelinePosFromClientX, getSnappedPosition, currentTimeRef]);

  // --- STYLES & FILTRES ---
  const getClipStyle = useCallback((type: string) => {
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
    `${getClipLabel(clip)} — ${formatPx(clip.start)} → ${formatPx(clip.start + clip.width)} (${formatPx(clip.width)})`;

  // Pistes affichées : text + video + audio en mode 'video', uniquement audio sinon.
  // Toujours dans l'ordre : texte (haut), vidéo, audio (bas).
  const visibleTracks = useMemo(() => {
    const order: Record<string, number> = { text: 0, video: 1, audio: 2 };
    const ordered = [...tracks].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
    if (currentView === 'video') return ordered;
    return ordered.filter(t => t.type === 'audio');
  }, [tracks, currentView]);

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
          className="absolute bottom-0 border-l border-gray-700 h-2 pl-1 text-[10px] text-gray-500 whitespace-nowrap"
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
              className="absolute bottom-0 border-l border-gray-800 h-1"
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
      <TimelineToolbar onDeleteClip={removeClip} />
      <div
        ref={timelineRef}
        className={`timeline-container flex-1 overflow-x-auto overflow-y-hidden relative custom-scrollbar ${isScrubbing ? 'cursor-grabbing' : 'cursor-default'}`}
        style={{ touchAction: 'pan-x' }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPointerDown={handlePanPointerDown}
      >
        {/* RÈGLE — clic ici déplace la tête de lecture */}
        <div
          className="h-6 bg-gray-950 sticky top-0 border-b border-gray-800 flex items-end z-30 cursor-ew-resize"
          style={{ touchAction: 'none', minWidth: contentWidth }}
          onPointerDown={(e) => { e.stopPropagation(); handleScrubPointerDown(e); }}
        >
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

        {/* TÊTE DE LECTURE */}
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 w-4 -ml-2 z-50 cursor-ew-resize flex justify-center group"
          style={{
            transform: `translateX(${currentTime * zoomLevel}px)`,
            willChange: 'transform'
          }}
          onPointerDown={(e) => { e.stopPropagation(); handleScrubPointerDown(e); }}
        >
           <div className="w-px h-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
           <div className="absolute top-0 w-3 h-3 bg-red-500 rotate-45 -mt-1.5 transform group-hover:scale-125 transition-transform"></div>
        </div>

        {/* ZONE DES PISTES */}
        <div className="relative">
          {/* Marqueur de fin de projet */}
          {projectDurationPx > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px border-l border-dashed border-gray-600/70 z-10 pointer-events-none"
              style={{ left: projectEndX }}
            />
          )}

          {/* Guide d'aimantation */}
          {snapGuideX !== null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-cyan-400/80 z-40 pointer-events-none"
              style={{ left: snapGuideX }}
            />
          )}

          {/* État vide */}
          {clips.length === 0 && (
            <div className="absolute inset-0 z-30 pointer-events-none">
              <div
                className="sticky left-0 h-full pl-20 flex flex-col items-center justify-center gap-1 text-gray-600 text-xs text-center"
                style={{ width: viewportWidth || '100%' }}
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
                : 'bg-green-900/30 text-green-400';
            return (
              <div
                key={track.id}
                className={`${trackHeight} bg-gray-900/50 border-b border-gray-800 relative my-1`}
                style={{ minWidth: contentWidth }}
              >
                <div className={`absolute top-0 bottom-0 left-0 w-20 border-r border-gray-700 z-40 sticky left-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-tighter ${labelBg}`}>
                  {track.name}
                </div>
                {clipsForTrack(track).map(clip => (
                  <div
                    key={clip.id}
                    title={getClipTitle(clip)}
                    className={`absolute top-1 bottom-1 rounded border overflow-hidden flex items-center px-2 text-xs group transition-all duration-150
                      ${getClipStyle(clip.type)}
                      ${activeTool === 'cut' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}
                      ${selectedClipId === clip.id ? 'ring-2 ring-white border-white z-20 shadow-[0_0_15px_rgba(255,255,255,0.3)]' : 'hover:shadow-lg hover:shadow-white/5'}
                      ${draggingClipId === clip.id ? 'opacity-80 z-30' : ''}
                    `}
                    style={{
                      left: `${clip.start * zoomLevel}px`,
                      width: `${clip.width * zoomLevel}px`,
                      touchAction: 'none', // permet au pointermove tactile sans interférence du scroll
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (activeTool === 'select') {
                        handleClipPointerDown(e, clip);
                      }
                    }}
                    onPointerMove={(e) => handleClipPointerMove(e, clip)}
                    onPointerLeave={() => { if (activeTool === 'cut') setCutHover(null); }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeTool === 'select') setSelectedClipId(clip.id);
                      handleClipClick(e, clip);
                    }}
                  >
                    {activeTool === 'select' && (
                      <>
                        {/* Trim handles : zone tactile de 14px (≈ pouce iPad) */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-3.5 cursor-ew-resize hover:bg-white/30 z-10 touch-none"
                          style={{ touchAction: 'none' }}
                          onPointerDown={(e) => handleTrim(e, clip, 'start')}
                        />
                        <div
                          className="absolute right-0 top-0 bottom-0 w-3.5 cursor-ew-resize hover:bg-white/30 z-10 touch-none"
                          style={{ touchAction: 'none' }}
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
                      />
                    )}
                    <div className="relative z-[1] flex items-center min-w-0 w-full">
                      {clip.type === 'audio' && <Music size={12} className="mr-2 shrink-0 opacity-70" />}
                      {clip.type === 'text' && <Type size={12} className="mr-2 shrink-0 opacity-50" />}
                      <span className="truncate drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">{getClipLabel(clip)}</span>
                    </div>

                    {/* Bouton de suppression (X rouge en haut à droite) */}
                    <button
                      type="button"
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
                  </div>
                ))}
              </div>
            );
          })}

          {/* Boutons d'ajout de pistes */}
          <div className="flex items-center gap-2 p-2" style={{ minWidth: contentWidth }}>
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
    </div>
  );
}
