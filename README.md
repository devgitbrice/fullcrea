# fullcrea

Éditeur vidéo / audio web (Next.js + React + Tailwind).

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** pour le styling
- **lucide-react** pour les icônes
- **Web Audio API** + canvas pour la visualisation des waveforms
- **Supabase** (Postgres + Storage) pour la persistance — optionnelle, fallback `localStorage`

## Démarrage

```bash
npm install
npm run dev
```

L'app fonctionne immédiatement en mode **localStorage** (les projets sont sauvegardés dans le navigateur).

## Brancher Supabase (persistance cloud + multi-device)

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Dashboard → **SQL Editor → New query** → coller le contenu de [`supabase/schema.sql`](./supabase/schema.sql) → **Run**.
3. Dashboard → **Authentication → Providers → Anonymous Sign-Ins** → activer (le front utilise l'auth anonyme par défaut).
4. Copier `.env.example` en `.env.local` et renseigner :

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

5. Relancer `npm run dev`. Au premier chargement :
   - une session anonyme est créée
   - le projet par défaut "Mon Film 01" est inséré dans la base
   - tous les changements (création de projet, drag de clips, import d'assets…) sont sauvegardés automatiquement (debouncé)

## Schéma de la base

Les tables sont préfixées `fullcrea_` :

| Table                       | Rôle                                              |
|-----------------------------|---------------------------------------------------|
| `fullcrea_projects`         | Liste des projets (rattachés à `auth.users`)      |
| `fullcrea_project_settings` | Résolution / FPS du projet (1-1)                  |
| `fullcrea_tracks`           | Pistes du projet                                  |
| `fullcrea_assets`           | Médias importés (URL publique du bucket Storage)  |
| `fullcrea_clips`            | Clips placés sur la timeline                      |

Le bucket Storage `fullcrea-assets` est public en lecture, écritures protégées par RLS (chaque user n'écrit que dans son dossier `<user_id>/<project_id>/`).

## Raccourcis clavier

| Raccourci          | Action                                  |
|--------------------|-----------------------------------------|
| `V`                | Outil sélection                         |
| `C`                | Outil cutter                            |
| `T`                | Outil texte                             |
| `Espace`           | Play / Pause sur la timeline            |
| `Suppr` / `⌫`      | Supprimer le clip sélectionné           |
| `Ctrl/Cmd + molette` (sur la timeline) | Zoom horizontal             |
