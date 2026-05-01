"use client";

import { useState, ChangeEvent, FormEvent } from 'react';
import { useProject } from '@/components/ProjectContext';
import { GEMINI_VOICES, DEFAULT_VOICE } from '@/lib/gemini/voices';
import { X, Loader2, Wand2, Film, Mic, AlertTriangle, Image as ImageIcon, Upload } from 'lucide-react';

type ModalShellProps = {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
};

function ModalShell({ title, icon, onClose, children }: ModalShellProps) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-950 border border-gray-800 rounded-lg shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white font-semibold text-sm">
            {icon}
            {title}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="text-xs text-red-300 bg-red-950/60 border border-red-900 rounded p-2 flex items-start gap-2">
      <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
      <span className="break-words">{msg}</span>
    </div>
  );
}

async function readJsonError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// =====================================================
// IMAGE
// =====================================================
export function ImageGenerationModal({ onClose }: { onClose: () => void }) {
  const { uploadAssetFile, setAssets } = useProject();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/gemini/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(await readJsonError(res));
      const blob = await res.blob();
      const file = new File([blob], `gemini-${Date.now()}.png`, { type: blob.type || 'image/png' });
      const asset = await uploadAssetFile(file);
      setAssets((prev) => [...prev, asset]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Créer une image" icon={<ImageIcon size={14} className="text-purple-400" />} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-xs text-gray-400">Décris ce que tu veux générer</label>
        <textarea
          required
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Un chat astronaute sur la Lune, style aquarelle…"
          className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-purple-600 resize-none"
        />
        {error && <ErrorBox msg={error} />}
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white py-2 rounded text-sm font-medium transition"
        >
          {loading ? <><Loader2 size={14} className="animate-spin" /> Génération…</> : <><Wand2 size={14} /> Générer</>}
        </button>
      </form>
    </ModalShell>
  );
}

// =====================================================
// VIDEO (Veo 3)
// =====================================================
type VideoSource = 'prompt' | 'project' | 'upload';

async function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mime: file.type || 'image/png' };
}

async function urlToBase64(url: string): Promise<{ base64: string; mime: string }> {
  const res = await fetch(url);
  const blob = await res.blob();
  return fileToBase64(new File([blob], 'image', { type: blob.type }));
}

export function VideoGenerationModal({ onClose }: { onClose: () => void }) {
  const { uploadAssetFile, setAssets, assets } = useProject();
  const [source, setSource] = useState<VideoSource>('prompt');
  const [prompt, setPrompt] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imageAssets = assets.filter((a) => a.type === 'image');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let imageBase64: string | null = null;
      let imageMime: string | null = null;

      if (source === 'project') {
        if (!selectedAssetId) throw new Error('Choisis une image du projet');
        const a = imageAssets.find((x) => x.id === selectedAssetId);
        if (!a) throw new Error('Image introuvable');
        const r = await urlToBase64(a.src);
        imageBase64 = r.base64; imageMime = r.mime;
      } else if (source === 'upload') {
        if (!uploadFile) throw new Error('Sélectionne un fichier');
        const r = await fileToBase64(uploadFile);
        imageBase64 = r.base64; imageMime = r.mime;
      }

      setStatus('Lancement…');
      const startRes = await fetch('/api/gemini/video/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, imageBase64, imageMime }),
      });
      if (!startRes.ok) throw new Error(await readJsonError(startRes));
      const { operationName } = await startRes.json();
      if (!operationName) throw new Error('Pas d\'identifiant d\'opération renvoyé');

      // Polling toutes les 5s
      let elapsed = 0;
      let done = false;
      let videoUri: string | null = null;
      while (!done) {
        await new Promise((r) => setTimeout(r, 5000));
        elapsed += 5;
        setStatus(`Génération en cours… (${elapsed}s)`);
        const pollRes = await fetch('/api/gemini/video/poll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationName }),
        });
        if (!pollRes.ok) throw new Error(await readJsonError(pollRes));
        const data = await pollRes.json();
        done = !!data.done;
        videoUri = data.videoUri ?? null;
      }

      if (!videoUri) throw new Error('Aucune vidéo dans la réponse Veo');

      setStatus('Téléchargement…');
      const dlRes = await fetch('/api/gemini/video/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUri }),
      });
      if (!dlRes.ok) throw new Error(await readJsonError(dlRes));
      const blob = await dlRes.blob();
      const file = new File([blob], `veo-${Date.now()}.mp4`, { type: 'video/mp4' });

      setStatus('Upload Supabase…');
      const asset = await uploadAssetFile(file);
      setAssets((prev) => [...prev, asset]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  return (
    <ModalShell title="Créer une vidéo (Veo 3)" icon={<Film size={14} className="text-blue-400" />} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-1 bg-gray-900 p-1 rounded">
          {(['prompt', 'project', 'upload'] as VideoSource[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={`flex-1 text-[11px] py-1.5 rounded transition ${
                source === s ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {s === 'prompt' ? 'Prompt seul' : s === 'project' ? 'Image projet' : 'Importer'}
            </button>
          ))}
        </div>

        {source === 'project' && (
          <select
            required
            value={selectedAssetId}
            onChange={(e) => setSelectedAssetId(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600"
          >
            <option value="">— Choisir une image —</option>
            {imageAssets.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}

        {source === 'upload' && (
          <label className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm cursor-pointer hover:border-blue-600">
            <Upload size={14} />
            <span className="flex-1 truncate text-gray-300">
              {uploadFile?.name ?? 'Sélectionner une image…'}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </label>
        )}

        <label className="block text-xs text-gray-400">Prompt {source !== 'prompt' && '(optionnel)'}</label>
        <textarea
          required={source === 'prompt'}
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={source === 'prompt' ? 'Une plage tropicale au coucher de soleil…' : 'Anime cette image avec un travelling vers la gauche…'}
          className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-600 resize-none"
        />

        {loading && status && (
          <div className="text-xs text-blue-300 bg-blue-950/40 border border-blue-900 rounded p-2 flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" />
            {status}
          </div>
        )}
        {error && <ErrorBox msg={error} />}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white py-2 rounded text-sm font-medium transition"
        >
          {loading ? <><Loader2 size={14} className="animate-spin" /> En cours…</> : <><Film size={14} /> Générer la vidéo</>}
        </button>
        <p className="text-[10px] text-gray-500 leading-snug">
          Génération asynchrone, 1 à 3 minutes en moyenne. Ne ferme pas l'onglet.
        </p>
      </form>
    </ModalShell>
  );
}

// =====================================================
// VOIX OFF (TTS)
// =====================================================
export function TTSGenerationModal({ onClose }: { onClose: () => void }) {
  const { uploadAssetFile, setAssets } = useProject();
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/gemini/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) throw new Error(await readJsonError(res));
      const blob = await res.blob();
      const file = new File([blob], `voix-${Date.now()}.wav`, { type: 'audio/wav' });
      const asset = await uploadAssetFile(file);
      setAssets((prev) => [...prev, asset]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell title="Créer une voix off" icon={<Mic size={14} className="text-emerald-400" />} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-xs text-gray-400">Texte à lire (français)</label>
        <textarea
          required
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Bonjour, bienvenue dans cette présentation…"
          className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-600 resize-none"
        />

        <label className="block text-xs text-gray-400">Voix</label>
        <select
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          className="w-full bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
        >
          {GEMINI_VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>

        {error && <ErrorBox msg={error} />}

        <button
          type="submit"
          disabled={loading || !text.trim()}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white py-2 rounded text-sm font-medium transition"
        >
          {loading ? <><Loader2 size={14} className="animate-spin" /> Génération…</> : <><Mic size={14} /> Générer la voix</>}
        </button>
      </form>
    </ModalShell>
  );
}

// =====================================================
// SECTION CRÉATION (3 boutons dans la sidebar)
// =====================================================
export function CreationSection() {
  const [open, setOpen] = useState<null | 'image' | 'video' | 'tts'>(null);

  return (
    <>
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-pink-400 uppercase px-2 mb-2 pt-2 border-t border-gray-800/50">
          <Wand2 size={12} /> Création
        </div>
        <div className="space-y-1.5 px-1">
          <button
            onClick={() => setOpen('image')}
            className="w-full flex items-center gap-2 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-900 text-purple-100 px-3 py-2 rounded text-xs font-medium transition"
          >
            <ImageIcon size={13} /> Créer une image
          </button>
          <button
            onClick={() => setOpen('video')}
            className="w-full flex items-center gap-2 bg-blue-900/30 hover:bg-blue-900/50 border border-blue-900 text-blue-100 px-3 py-2 rounded text-xs font-medium transition"
          >
            <Film size={13} /> Créer une vidéo
          </button>
          <button
            onClick={() => setOpen('tts')}
            className="w-full flex items-center gap-2 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-900 text-emerald-100 px-3 py-2 rounded text-xs font-medium transition"
          >
            <Mic size={13} /> Créer une voix off
          </button>
        </div>
      </div>

      {open === 'image' && <ImageGenerationModal onClose={() => setOpen(null)} />}
      {open === 'video' && <VideoGenerationModal onClose={() => setOpen(null)} />}
      {open === 'tts' && <TTSGenerationModal onClose={() => setOpen(null)} />}
    </>
  );
}
