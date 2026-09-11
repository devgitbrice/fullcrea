"use client";

import { useEffect, useRef, useState, ReactNode, FormEvent } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { LogIn, UserPlus, AlertTriangle, Loader2, Eye, EyeOff, Mail, ArrowLeft, KeyRound } from 'lucide-react';

type Mode = 'signin' | 'signup' | 'reset';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const client = getSupabase();
    setSupabase(client);

    if (!client) {
      setChecking(false);
      return;
    }

    // Filet de sécurité si l'événement PASSWORD_RECOVERY est raté (client déjà initialisé) :
    // le hash est encore présent ici car supabase-js le parse et le retire de façon asynchrone.
    if (/[#&]type=recovery(&|$)/.test(window.location.hash)) setRecovering(true);

    let cancelled = false;
    client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setChecking(false);
    });

    const { data: sub } = client.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
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
            d&apos;environnement, puis redéploie.
          </p>
        </div>
      </div>
    );
  }

  // Doit précéder le test de session : la session de récupération est une session valide.
  if (session && recovering) {
    return <NewPasswordForm supabase={supabase} onDone={() => setRecovering(false)} />;
  }

  if (!session) {
    return <AuthForm supabase={supabase} />;
  }

  return <>{children}</>;
}

const SUBTITLES: Record<Mode, string> = {
  signin: 'Connecte-toi pour accéder à tes projets.',
  signup: 'Crée un compte pour commencer.',
  reset: 'Entre ton email pour recevoir un lien de réinitialisation.',
};

function friendlyAuthError(err: unknown): string {
  if (!(err instanceof Error)) return 'Erreur inconnue';
  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  const msg = err.message.toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Email ou mot de passe incorrect.';
  }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Confirme ton adresse email avant de te connecter.';
  }
  if (code === 'user_already_exists' || msg.includes('user already registered')) {
    return 'Un compte existe déjà avec cet email.';
  }
  if (code.includes('rate_limit') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Trop de tentatives, réessaie dans quelques minutes.';
  }
  return err.message;
}

function AuthForm({ supabase }: { supabase: SupabaseClient }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setInfo("Compte créé. Vérifie ta boîte mail pour confirmer l'adresse, puis connecte-toi.");
          setMode('signin');
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setInfo('Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.');
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const tabClass = (active: boolean) =>
    `flex-1 text-xs py-1.5 rounded transition ${active ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'}`;

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white p-6">
      <div className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-lg p-6 shadow-2xl">
        <h1 className="text-xl font-bold tracking-tight mb-1">Gennn Cut</h1>
        <p className="text-sm text-gray-500 mb-5">{SUBTITLES[mode]}</p>

        {mode !== 'reset' && (
          <div className="flex gap-1 mb-5 bg-gray-900 p-1 rounded">
            <button type="button" onClick={() => switchMode('signin')} className={tabClass(mode === 'signin')}>
              Connexion
            </button>
            <button type="button" onClick={() => switchMode('signup')} className={tabClass(mode === 'signup')}>
              Créer un compte
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="auth-email" className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              id="auth-email"
              ref={emailRef}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label htmlFor="auth-password" className="block text-xs text-gray-400 mb-1">Mot de passe</label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-800 rounded pl-3 pr-9 py-2 text-sm focus:outline-none focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute inset-y-0 right-0 flex items-center px-2.5 text-gray-500 hover:text-gray-200 transition"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {mode === 'signin' && (
                <div className="flex justify-end mt-1.5">
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline transition"
                  >
                    Mot de passe oublié ?
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2"
            >
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
              <span className="break-words">{error}</span>
            </div>
          )}
          {info && (
            <div role="status" className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded p-2">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={14} />
            ) : mode === 'signin' ? (
              <><LogIn size={14} /> Se connecter</>
            ) : mode === 'signup' ? (
              <><UserPlus size={14} /> Créer mon compte</>
            ) : (
              <><Mail size={14} /> Envoyer le lien de réinitialisation</>
            )}
          </button>

          {mode === 'reset' && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline transition"
              >
                <ArrowLeft size={12} /> Retour à la connexion
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function NewPasswordForm({ supabase, onDone }: { supabase: SupabaseClient; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-black text-white p-6">
      <div className="w-full max-w-sm bg-gray-950 border border-gray-800 rounded-lg p-6 shadow-2xl">
        <h1 className="text-xl font-bold tracking-tight mb-1">Nouveau mot de passe</h1>
        <p className="text-sm text-gray-500 mb-5">Choisis un nouveau mot de passe pour ton compte.</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="new-password" className="block text-xs text-gray-400 mb-1">Mot de passe</label>
            <div className="relative">
              <input
                id="new-password"
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-900 border border-gray-800 rounded pl-3 pr-9 py-2 text-sm focus:outline-none focus:border-blue-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute inset-y-0 right-0 flex items-center px-2.5 text-gray-500 hover:text-gray-200 transition"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2"
            >
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition"
          >
            {loading ? <Loader2 className="animate-spin" size={14} /> : <><KeyRound size={14} /> Enregistrer le mot de passe</>}
          </button>

          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <ArrowLeft size={12} /> Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
