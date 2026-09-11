"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { HardDrive, LogOut, Loader2, User, Cloud } from 'lucide-react';
import { useProject } from '@/components/ProjectContext';
import type { SaveStatus } from '@/components/ProjectContext';
import { useToast } from '@/components/Toast';
import { useEscapeKey } from '@/lib/hooks/useEscapeKey';
import { getSupabase } from '@/lib/supabase/client';

// Borne l'attente de la sauvegarde avant déconnexion : au-delà, on considère
// le réseau bloqué et on laisse l'utilisateur trancher.
const SAVE_SETTLE_TIMEOUT_MS = 15000;
const SAVE_SETTLE_POLL_MS = 100;

export default function UserMenu() {
  const { userEmail, persistenceMode, saveStatus } = useProject();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Miroir du statut pour que le handler async lise la valeur courante.
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => {
    saveStatusRef.current = saveStatus;
  }, [saveStatus]);

  const close = useCallback(() => setOpen(false), []);

  const handleEscape = useCallback(() => {
    close();
    triggerRef.current?.focus();
  }, [close]);

  useEscapeKey(handleEscape, open);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, close]);

  if (userEmail === null && persistenceMode !== 'cloud') {
    return (
      <div
        role="img"
        aria-label="Mode local"
        title="Mode local"
        className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-900 border border-gray-800 text-gray-400"
      >
        <HardDrive size={14} />
      </div>
    );
  }

  const initial = userEmail?.trim().charAt(0).toUpperCase() ?? '';
  const flushingSave = signingOut && (saveStatus === 'dirty' || saveStatus === 'saving');

  // Attend que la sauvegarde débouncée parte et se termine : signOut() révoque
  // la session et démonte ProjectProvider, ce qui perdrait les modifications
  // en attente ou ferait échouer l'upsert en cours.
  const waitForSaveToSettle = () =>
    new Promise<SaveStatus>((resolve) => {
      const started = Date.now();
      const tick = () => {
        const s = saveStatusRef.current;
        if (s !== 'dirty' && s !== 'saving') return resolve(s);
        if (Date.now() - started > SAVE_SETTLE_TIMEOUT_MS) return resolve('error');
        setTimeout(tick, SAVE_SETTLE_POLL_MS);
      };
      tick();
    });

  const handleSignOut = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      toast({ message: 'Supabase non configuré, déconnexion impossible.', type: 'error' });
      return;
    }
    setSigningOut(true);
    try {
      const settled = await waitForSaveToSettle();
      if (settled === 'error') {
        const proceed = window.confirm('Des modifications ne sont pas enregistrées. Se déconnecter quand même ?');
        if (!proceed) return;
      }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      close();
    } catch (err) {
      toast({
        message: `Déconnexion échouée : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
        type: 'error',
      });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={userEmail ? `Compte : ${userEmail}` : 'Compte'}
        title={userEmail ?? 'Compte'}
        className={`flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition ring-offset-2 ring-offset-gray-950 ${
          open ? 'ring-2 ring-blue-400' : ''
        }`}
      >
        {initial || <User size={14} />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu du compte"
          className="absolute right-0 top-full mt-2 w-64 bg-gray-950 border border-gray-800 rounded-md shadow-2xl z-50 overflow-hidden"
        >
          <div className="px-3 py-2.5 border-b border-gray-800">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">Connecté</div>
            <div className="text-xs text-gray-200 truncate" title={userEmail ?? undefined}>
              {userEmail ?? 'Email inconnu'}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-gray-500">
              {persistenceMode === 'cloud' ? <Cloud size={11} /> : <HardDrive size={11} />}
              {persistenceMode === 'cloud' ? 'Projets synchronisés dans le cloud' : 'Projets stockés en local'}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            title={flushingSave ? 'Enregistrement en cours…' : undefined}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40 hover:text-red-200 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {signingOut ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
            {flushingSave ? 'Enregistrement…' : 'Se déconnecter'}
          </button>
        </div>
      )}
    </div>
  );
}
