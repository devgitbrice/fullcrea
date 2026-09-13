"use client";

import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutGrid, List, Plus, Search, Loader2, Film, Eye, PencilLine, Link2, Users, Trash2,
  Cloud, HardDrive, Clock, Layers, Image as ImageIcon, MoreHorizontal, Pencil, Check, X, AlertTriangle,
} from 'lucide-react';
import { useProject, type Project } from '@/components/ProjectContext';
import { PX_PER_SEC_BASE } from '@/lib/timeline/types';
import { sequenceDurationPx } from '@/lib/timeline/clipOps';
import { useToast } from '@/components/Toast';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import UserMenu from '@/components/editor/UserMenu';
import QuickLinks from '@/components/QuickLinks';
import { ChromeLinks } from '@/components/EditorChrome';
import ProjectPreviewModal from './ProjectPreviewModal';
import { getSupabase } from '@/lib/supabase/client';
import { createLiveShare, findLiveShare } from '@/lib/supabase/sharesRepo';
import { buildShareViewLink, buildEditLink, copyToClipboard, formatRelativeDate } from '@/lib/share';

type ViewMode = 'grid' | 'list';
const VIEW_STORAGE_KEY = 'fullcrea_projects_view';
const OPEN_AFTER_SAVE_TIMEOUT_MS = 5000;

function readStoredView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function activeSequence(p: Project) {
  return p.sequences.find(s => s.id === p.activeSequenceId) ?? p.sequences[0];
}

function projectDurationLabel(p: Project): string {
  const px = sequenceDurationPx(activeSequence(p)?.clips ?? p.clips);
  const total = Math.round(px / PX_PER_SEC_BASE);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function clipCount(p: Project): number {
  return p.sequences.reduce((n, s) => n + s.clips.length, 0) || p.clips.length;
}

export default function ProjectsHome() {
  const {
    projects, isHydrated, createProject, renameProject, deleteProject,
    persistenceMode, isPersistenceCloud, saveStatus, userId,
  } = useProject();
  const { toast } = useToast();
  const router = useRouter();

  const [view, setView] = useState<ViewMode>('grid');
  const [query, setQuery] = useState('');
  const [previewProject, setPreviewProject] = useState<Project | null>(null);
  // armed = le cycle de sauvegarde du nouveau projet a démarré (dirty/saving) ;
  // sans cela un statut 'saved' hérité d'une écriture précédente ouvrirait trop tôt.
  const [pendingOpen, setPendingOpen] = useState<{ id: string; armed: boolean } | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  useEffect(() => {
    setView(readStoredView());
  }, []);

  const changeView = (next: ViewMode) => {
    setView(next);
    try { localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* stockage indisponible */ }
  };

  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects;
    return [...list].sort((a, b) => {
      const da = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const db = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (da !== db) return db - da;
      return a.name.localeCompare(b.name, 'fr');
    });
  }, [projects, query]);

  const openProject = useCallback((id: string) => {
    router.push(`/editor/${encodeURIComponent(id)}`);
  }, [router]);

  // Un nouveau projet n'est ouvert qu'une fois écrit : l'éditeur recharge
  // la liste depuis Supabase et ne le verrait pas sinon.
  const handleCreate = () => {
    const id = createProject();
    setPendingOpen({ id, armed: false });
  };

  useEffect(() => {
    if (!pendingOpen) return;
    const { id, armed } = pendingOpen;
    if (!armed) {
      if (saveStatus === 'dirty' || saveStatus === 'saving') setPendingOpen({ id, armed: true });
    } else if (saveStatus === 'saved') {
      openProject(id);
      return;
    } else if (saveStatus === 'error') {
      toast({ type: 'error', message: "Le projet n'a pas pu être enregistré. Réessayez." });
      setPendingOpen(null);
      return;
    }
    const handle = setTimeout(() => openProject(id), OPEN_AFTER_SAVE_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [pendingOpen, saveStatus, openProject, toast]);

  const copyText = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    toast(ok
      ? { type: 'success', message: `${label} copié dans le presse-papiers.` }
      : { type: 'error', message: `Impossible de copier le ${label.toLowerCase()}.` });
  };

  // Lien de visualisation = partage en direct (/v/<id>) sur la timeline active :
  // réutilisé s'il existe déjà, créé sinon.
  const copyViewLink = async (p: Project) => {
    if (!isPersistenceCloud || !userId) {
      toast({ type: 'warning', message: 'Le lien de visualisation nécessite la connexion cloud (Supabase).' });
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    setSharingId(p.id);
    try {
      const seq = activeSequence(p);
      const sequenceId = seq?.id ?? p.activeSequenceId;
      const existing = await findLiveShare(supabase, userId, p.id, sequenceId);
      const share = existing ?? await createLiveShare(supabase, userId, {
        projectId: p.id,
        sequenceId,
        title: seq && p.sequences.length > 1 ? `${p.name} — ${seq.name}` : p.name,
        width: p.projectSettings.width,
        height: p.projectSettings.height,
        durationSec: sequenceDurationPx(seq?.clips ?? p.clips) / PX_PER_SEC_BASE,
      });
      await copyText(buildShareViewLink(share.id), 'Lien de visualisation');
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Lien de visualisation impossible' });
    } finally {
      setSharingId(null);
    }
  };

  const copyEditLink = (p: Project) => {
    const link = buildEditLink(p);
    if (!link) {
      toast({ type: 'warning', message: 'Seul le propriétaire du projet peut partager un lien de co-édition (connexion cloud requise).' });
      return;
    }
    void copyText(link, 'Lien de co-édition');
  };

  const handleDelete = (p: Project) => {
    deleteProject(p.id);
    toast({ type: 'info', message: `« ${p.name} » supprimé.` });
  };

  if (!isHydrated) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 bg-black text-gray-400">
        <Loader2 className="animate-spin" size={24} />
        <span className="text-xs">Chargement de vos projets…</span>
      </div>
    );
  }

  const itemProps = (p: Project): ProjectItemProps => ({
    project: p,
    isOwner: !p.ownerId || !userId || p.ownerId === userId,
    sharing: sharingId === p.id,
    onPreview: () => setPreviewProject(p),
    onOpen: () => openProject(p.id),
    onCopyView: () => { void copyViewLink(p); },
    onCopyEdit: () => copyEditLink(p),
    onRename: (name) => renameProject(p.id, name),
    onDelete: () => handleDelete(p),
  });

  return (
    // Le body est overflow-hidden : la page porte son propre défilement
    <div className="h-screen w-full overflow-y-auto bg-black text-white flex flex-col custom-scrollbar" style={{ touchAction: 'pan-y' }}>
      <header className="sticky top-0 z-40 bg-gray-950/90 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 min-h-14 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-bold text-lg tracking-tight">Gennn CUT</span>
            <span className="text-gray-600">/</span>
            <span className="text-sm text-gray-300">Mes projets</span>
            <span className="text-[10px] text-gray-500 bg-gray-900 border border-gray-800 rounded-full px-2 py-0.5">
              {projects.length}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ChromeLinks />
            <span
              className="hidden sm:flex items-center gap-1 text-[10px] text-gray-500"
              title={persistenceMode === 'cloud' ? 'Projets synchronisés dans le cloud' : 'Projets stockés dans ce navigateur'}
            >
              {persistenceMode === 'cloud' ? <Cloud size={11} /> : <HardDrive size={11} />}
              {persistenceMode === 'cloud' ? 'Cloud' : 'Local'}
            </span>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un projet…"
              aria-label="Rechercher un projet"
              className="w-full bg-gray-900 border border-gray-800 rounded-md pl-9 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-600"
            />
          </label>

          <div role="group" aria-label="Affichage" className="flex items-center gap-1 bg-gray-900 p-1 rounded-md border border-gray-800">
            <button
              type="button"
              onClick={() => changeView('grid')}
              aria-pressed={view === 'grid'}
              aria-label="Affichage en grille"
              title="Grille"
              className={`p-1.5 rounded transition ${view === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              type="button"
              onClick={() => changeView('list')}
              aria-pressed={view === 'list'}
              aria-label="Affichage en liste"
              title="Liste"
              className={`p-1.5 rounded transition ${view === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
            >
              <List size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={pendingOpen !== null}
            className="ml-auto flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition shadow-lg shadow-blue-900/20"
          >
            {pendingOpen ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Nouveau projet
          </button>
        </div>

        {visibleProjects.length === 0 ? (
          <div className="border border-dashed border-gray-800 rounded-lg p-10 text-center text-gray-500 space-y-2">
            <Film size={28} className="mx-auto text-gray-700" />
            <p className="text-sm">{query ? 'Aucun projet ne correspond à votre recherche.' : 'Aucun projet pour le moment.'}</p>
            {!query && <p className="text-xs">Cliquez sur « Nouveau projet » pour commencer.</p>}
          </div>
        ) : view === 'grid' ? (
          <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((p) => (
              <li key={p.id}><ProjectCard {...itemProps(p)} /></li>
            ))}
          </ul>
        ) : (
          <div className="border border-gray-800 rounded-lg overflow-hidden">
            <div className="hidden md:grid grid-cols-[1fr_120px_110px_90px_auto] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-gray-500 bg-gray-950 border-b border-gray-800">
              <span>Projet</span><span>Modifié</span><span>Format</span><span>Durée</span><span className="text-right">Actions</span>
            </div>
            <ul className="divide-y divide-gray-800">
              {visibleProjects.map((p) => (
                <li key={p.id}><ProjectRow {...itemProps(p)} /></li>
              ))}
            </ul>
          </div>
        )}

        {!isPersistenceCloud && (
          <p className="flex items-center gap-2 text-[11px] text-amber-300/80">
            <AlertTriangle size={12} />
            Mode local : les liens de partage nécessitent une connexion cloud (Supabase).
          </p>
        )}
      </main>

      {previewProject && (
        <ProjectPreviewModal project={previewProject} onClose={() => setPreviewProject(null)} />
      )}
      <QuickLinks />
    </div>
  );
}

// ---------- Éléments ----------

interface ProjectItemProps {
  project: Project;
  isOwner: boolean;
  sharing: boolean;
  onPreview: () => void;
  onOpen: () => void;
  onCopyView: () => void;
  onCopyEdit: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function useInlineRename(project: Project, onRename: (name: string) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const start = () => { setDraft(project.name); setEditing(true); };
  const cancel = () => setEditing(false);
  const commit = () => {
    const name = draft.trim();
    if (name && name !== project.name) onRename(name);
    setEditing(false);
  };
  return { editing, draft, setDraft, start, cancel, commit };
}

// Empêche le double-clic « ouvrir » de la carte de se déclencher depuis ses contrôles
const stopDoubleClick = (e: React.MouseEvent) => e.stopPropagation();

function RenameInput({ draft, setDraft, commit, cancel }: { draft: string; setDraft: (v: string) => void; commit: () => void; cancel: () => void }) {
  return (
    <div className="flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()} onDoubleClick={stopDoubleClick}>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
        }}
        aria-label="Nouveau nom du projet"
        className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
      />
      <button type="button" onClick={commit} aria-label="Valider le nom" className="p-1 rounded text-emerald-400 hover:bg-gray-800"><Check size={14} /></button>
      <button type="button" onClick={cancel} aria-label="Annuler" className="p-1 rounded text-gray-400 hover:bg-gray-800"><X size={14} /></button>
    </div>
  );
}

function ActionButton({ icon, label, onClick, tone = 'default', disabled = false, busy = false, showLabel = true }: {
  icon: ReactNode; label: string; onClick: () => void; tone?: 'default' | 'primary' | 'danger'; disabled?: boolean; busy?: boolean; showLabel?: boolean;
}) {
  const toneClass = tone === 'primary'
    ? 'bg-blue-600 hover:bg-blue-700 text-white'
    : tone === 'danger'
      ? 'text-red-300 hover:bg-red-950/40 hover:text-red-200'
      : 'text-gray-300 hover:bg-gray-800 hover:text-white';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={stopDoubleClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${toneClass}`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {showLabel && <span className="hidden xl:inline">{label}</span>}
    </button>
  );
}

function MoreMenu({ isOwner, onRename, onDelete }: { isOwner: boolean; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const close = useCallback(() => { setOpen(false); setConfirm(false); }, []);

  useEscapeKey(close, open);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, close]);

  return (
    <div
      className="relative"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={stopDoubleClick}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close(); }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Plus d'actions"
        title="Plus d'actions"
        className="p-1.5 rounded text-gray-400 hover:bg-gray-800 hover:text-white transition"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 w-52 bg-gray-950 border border-gray-800 rounded-md shadow-2xl z-50 overflow-hidden">
          <button
            type="button"
            role="menuitem"
            onClick={() => { close(); onRename(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800 transition"
          >
            <Pencil size={13} /> Renommer
          </button>
          {isOwner ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (!confirm) { setConfirm(true); return; }
                close(); onDelete();
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition ${confirm ? 'bg-red-600 text-white hover:bg-red-500' : 'text-red-300 hover:bg-red-950/40'}`}
            >
              <Trash2 size={13} /> {confirm ? 'Confirmer la suppression' : 'Supprimer'}
            </button>
          ) : (
            <div className="px-3 py-2 text-[10px] text-gray-500">Partagé avec vous — seul le propriétaire peut supprimer.</div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectMeta({ project }: { project: Project }) {
  const { width, height, fps } = project.projectSettings;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
      <span className="flex items-center gap-1" title="Dernière modification"><Clock size={11} />{formatRelativeDate(project.updatedAt) || '—'}</span>
      <span title="Format">{width}×{height} · {fps} fps</span>
      <span className="flex items-center gap-1" title="Clips (toutes timelines)"><Layers size={11} />{clipCount(project)}</span>
      <span className="flex items-center gap-1" title="Médias importés"><ImageIcon size={11} />{project.assets.length}</span>
      {project.sequences.length > 1 && <span title="Timelines">{project.sequences.length} timelines</span>}
    </div>
  );
}

function SharedBadge() {
  return (
    <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-purple-300 bg-purple-950/40 border border-purple-900 rounded-full px-1.5 py-0.5" title="Projet partagé avec vous en co-édition">
      <Users size={9} /> Partagé
    </span>
  );
}

function ProjectCard(props: ProjectItemProps) {
  const { project, isOwner, sharing, onPreview, onOpen, onCopyView, onCopyEdit, onRename, onDelete } = props;
  const rename = useInlineRename(project, onRename);
  const { width, height } = project.projectSettings;
  const firstImage = project.assets.find(a => a.type === 'image');

  return (
    <article
      className="group bg-gray-950 border border-gray-800 hover:border-gray-700 rounded-lg overflow-hidden flex flex-col transition shadow-lg cursor-pointer"
      onDoubleClick={onOpen}
      title="Double-cliquez pour ouvrir"
    >
      <button
        type="button"
        onClick={onPreview}
        onDoubleClick={stopDoubleClick}
        aria-label={`Prévisualiser ${project.name}`}
        className="relative w-full bg-gray-900 flex items-center justify-center overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        style={{ aspectRatio: '16 / 9' }}
      >
        {firstImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={firstImage.src} alt="" className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition" />
        ) : (
          <Film size={36} className="text-gray-700" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition">
          <span className="flex items-center gap-1.5 text-xs font-medium text-white bg-black/60 rounded-full px-3 py-1 opacity-0 group-hover:opacity-100 transition">
            <Eye size={13} /> Prévisualiser
          </span>
        </span>
        <span className="absolute bottom-2 right-2 text-[10px] font-mono text-gray-300 bg-black/60 rounded px-1.5 py-0.5">
          {projectDurationLabel(project)}
        </span>
        <span className="absolute top-2 left-2 text-[10px] text-gray-300 bg-black/60 rounded px-1.5 py-0.5">
          {width}×{height}
        </span>
      </button>

      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          {rename.editing ? (
            <RenameInput draft={rename.draft} setDraft={rename.setDraft} commit={rename.commit} cancel={rename.cancel} />
          ) : (
            <h3 className="text-base font-semibold text-white truncate flex-1" title={project.name}>{project.name}</h3>
          )}
          <div className="flex items-center gap-1 shrink-0">
            {!isOwner && <SharedBadge />}
            <MoreMenu isOwner={isOwner} onRename={rename.start} onDelete={onDelete} />
          </div>
        </div>
        <ProjectMeta project={project} />
        <div className="mt-auto pt-2 flex flex-wrap items-center gap-1 border-t border-gray-800/70">
          <ActionButton icon={<Eye size={14} />} label="Prévisualiser" onClick={onPreview} />
          <ActionButton icon={<PencilLine size={14} />} label="Ouvrir" onClick={onOpen} tone="primary" />
          <div className="ml-auto flex items-center gap-1">
            <ActionButton icon={<Link2 size={14} />} label="Copier lien de visualisation" onClick={onCopyView} busy={sharing} />
            <ActionButton icon={<Users size={14} />} label="Copier lien de co-édition" onClick={onCopyEdit} disabled={!isOwner} />
          </div>
        </div>
      </div>
    </article>
  );
}

function ProjectRow(props: ProjectItemProps) {
  const { project, isOwner, sharing, onPreview, onOpen, onCopyView, onCopyEdit, onRename, onDelete } = props;
  const rename = useInlineRename(project, onRename);
  const { width, height } = project.projectSettings;

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_110px_90px_auto] gap-2 md:gap-3 items-center px-4 py-3 hover:bg-gray-900/60 transition cursor-pointer"
      onDoubleClick={onOpen}
      title="Double-cliquez pour ouvrir"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded bg-gray-900 border border-gray-800 flex items-center justify-center shrink-0 text-gray-600">
          <Film size={18} />
        </div>
        <div className="min-w-0 flex-1">
          {rename.editing ? (
            <RenameInput draft={rename.draft} setDraft={rename.setDraft} commit={rename.commit} cancel={rename.cancel} />
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base font-semibold text-white truncate" title={project.name}>{project.name}</span>
              {!isOwner && <SharedBadge />}
            </div>
          )}
          <div className="text-[11px] text-gray-500 flex items-center gap-3 whitespace-nowrap">
            <span className="flex items-center gap-1"><Layers size={11} />{clipCount(project)} clips</span>
            <span className="flex items-center gap-1"><ImageIcon size={11} />{project.assets.length} médias</span>
          </div>
        </div>
      </div>
      <span className="text-xs text-gray-400 hidden md:flex items-center gap-1 whitespace-nowrap"><Clock size={11} />{formatRelativeDate(project.updatedAt) || '—'}</span>
      <span className="text-xs text-gray-400 hidden md:inline">{width}×{height}</span>
      <span className="text-xs font-mono text-gray-400 hidden md:inline">{projectDurationLabel(project)}</span>
      {/* Actions en icônes (libellés en infobulle) pour laisser la place au nom du projet */}
      <div className="flex items-center justify-end gap-1">
        <ActionButton icon={<Eye size={15} />} label="Prévisualiser" onClick={onPreview} showLabel={false} />
        <ActionButton icon={<PencilLine size={14} />} label="Ouvrir" onClick={onOpen} tone="primary" />
        <ActionButton icon={<Link2 size={15} />} label="Copier lien de visualisation" onClick={onCopyView} busy={sharing} showLabel={false} />
        <ActionButton icon={<Users size={15} />} label="Copier lien de co-édition" onClick={onCopyEdit} disabled={!isOwner} showLabel={false} />
        <MoreMenu isOwner={isOwner} onRename={rename.start} onDelete={onDelete} />
      </div>
    </div>
  );
}
