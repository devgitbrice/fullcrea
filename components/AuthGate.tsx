"use client";

import { useEffect, useState, ReactNode, FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { LogIn, UserPlus, AlertTriangle, Loader2 } from 'lucide-react';

type Mode = 'signin' | 'signup';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const client = getSupabase();
    setSupabase(client);

    if (!client) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setChecking(false);
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (checking) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-gray-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (!supabase) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-gray-300 p-6">
        <div className="max-w-md text-center space-y-3">
          <AlertTriangle className="mx-auto text-amber-400" size={32} />
          <h1 className="text-xl font-semibold text-white">Supabase non configuré</h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            Ajoute <code className="bg-gray-900 px-1 py-0.5 rounded text-gray-200">NEXT_PUBLIC_SUPABASE_URL</code> et{' '}
            <code className="bg-gray-900 px-1 py-0.5 rounded text-gray-200">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> aux variables
            d'environnement, puis redéploie.
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <AuthForm supabase={supabase} />;
  }

  return <>{children}</>;
}

function AuthForm({ supabase }: { supabase: SupabaseClient }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setInfo("Compte créé. Vérifie ta boîte mail pour confirmer l'adresse, puis connecte-toi.");
          setMode('signin');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white p-6">
      <div className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-lg p-6 shadow-2xl">
        <h1 className="text-xl font-bold tracking-tight mb-1">Studio Next</h1>
        <p className="text-sm text-gray-500 mb-5">
          {mode === 'signin' ? 'Connecte-toi pour accéder à tes projets.' : 'Crée un compte pour commencer.'}
        </p>

        <div className="flex gap-1 mb-5 bg-gray-900 p-1 rounded">
          <button
            type="button"
            onClick={() => { setMode('signin'); setError(null); setInfo(null); }}
            className={`flex-1 text-xs py-1.5 rounded transition ${
              mode === 'signin' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Connexion
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(null); setInfo(null); }}
            className={`flex-1 text-xs py-1.5 rounded transition ${
              mode === 'signup' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Créer un compte
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Mot de passe</label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          {error && (
            <div className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
              <span className="break-words">{error}</span>
            </div>
          )}
          {info && (
            <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded p-2">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={14} />
            ) : mode === 'signin' ? (
              <><LogIn size={14} /> Se connecter</>
            ) : (
              <><UserPlus size={14} /> Créer mon compte</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
