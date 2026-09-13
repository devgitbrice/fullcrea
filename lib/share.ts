import type { Project } from '@/lib/timeline/types';

function origin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

// Lien public de visualisation : lecteur /v/<id> d'un partage en direct
export function buildShareViewLink(shareId: string): string {
  return `${origin()}/v/${encodeURIComponent(shareId)}`;
}

// Lien de co-édition : ouvre l'éditeur et inscrit l'utilisateur connecté comme co-éditeur
export function buildEditLink(project: Pick<Project, 'id' | 'editToken'>): string | null {
  if (!project.editToken) return null;
  return `${origin()}/editor/${encodeURIComponent(project.id)}?t=${project.editToken}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // On tente le repli ci-dessous
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function formatRelativeDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
