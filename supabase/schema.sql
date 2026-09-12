-- =====================================================
-- FULLCREA — Schéma Supabase
-- À exécuter dans : Supabase Dashboard → SQL Editor → Run
-- Idempotent : peut être ré-exécuté sans casse.
--
-- CHECKLIST DE DÉPLOIEMENT
--   [ ] Ré-exécuter ce fichier ENTIER après chaque mise à jour de l'app :
--       la section 5 bis (migrations) ajoute les colonnes récentes
--       (offset_px, source_duration_px, volume, muted, hidden, locked, markers,
--       kind, tts, sequences, active_sequence_id, sequence_id, sequence_ref)
--       ajoute les colonnes de montage (speed, fades, transition, link_id,
--       solo, height_px, collapsed), crée la table fullcrea_shares (partage par
--       lien et intégration) et la
--       fonction fullcrea_share_payload (lecture publique d'un partage en direct).
--       Sans elles, l'insert échoue « column … does not exist » et l'indicateur
--       de sauvegarde passe en erreur.
--   [ ] Vérifier que le bucket 'fullcrea-assets' est Public (section 7).
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----- Fonction utilitaire pour updated_at -----
CREATE OR REPLACE FUNCTION fullcrea_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =====================================================
-- 1. fullcrea_projects
-- =====================================================
CREATE TABLE IF NOT EXISTS fullcrea_projects (
    id            TEXT PRIMARY KEY,
    user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    current_view  TEXT NOT NULL DEFAULT 'video'
                   CHECK (current_view IN ('video', 'podcast', 'music')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fullcrea_projects_user
    ON fullcrea_projects(user_id);

DROP TRIGGER IF EXISTS trg_fullcrea_projects_updated ON fullcrea_projects;
CREATE TRIGGER trg_fullcrea_projects_updated
    BEFORE UPDATE ON fullcrea_projects
    FOR EACH ROW EXECUTE FUNCTION fullcrea_set_updated_at();


-- =====================================================
-- 2. fullcrea_project_settings  (1-1 avec projects)
-- =====================================================
CREATE TABLE IF NOT EXISTS fullcrea_project_settings (
    project_id  TEXT PRIMARY KEY
                 REFERENCES fullcrea_projects(id) ON DELETE CASCADE,
    width       INTEGER NOT NULL DEFAULT 1920 CHECK (width  > 0),
    height      INTEGER NOT NULL DEFAULT 1080 CHECK (height > 0),
    fps         INTEGER NOT NULL DEFAULT 30   CHECK (fps    > 0)
);


-- =====================================================
-- 3. fullcrea_tracks  (N par projet)
-- =====================================================
CREATE TABLE IF NOT EXISTS fullcrea_tracks (
    project_id   TEXT NOT NULL
                  REFERENCES fullcrea_projects(id) ON DELETE CASCADE,
    track_index  INTEGER NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('video', 'audio', 'text')),
    name         TEXT NOT NULL,
    PRIMARY KEY (project_id, track_index)
);

-- Migration : si la table existait déjà avec l'ancien CHECK, on l'élargit pour inclure 'text'.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'fullcrea_tracks'
          AND constraint_name = 'fullcrea_tracks_type_check'
    ) THEN
        ALTER TABLE fullcrea_tracks DROP CONSTRAINT fullcrea_tracks_type_check;
    END IF;
    ALTER TABLE fullcrea_tracks
        ADD CONSTRAINT fullcrea_tracks_type_check
        CHECK (type IN ('video', 'audio', 'text'));
EXCEPTION WHEN duplicate_object THEN
    NULL; -- déjà appliqué
END $$;


-- =====================================================
-- 4. fullcrea_assets  (médias importés, par projet)
-- =====================================================
CREATE TABLE IF NOT EXISTS fullcrea_assets (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL
                 REFERENCES fullcrea_projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('video', 'audio', 'image')),
    src         TEXT NOT NULL,             -- URL publique du fichier dans le bucket
    storage_path TEXT,                      -- Chemin dans le bucket (utile pour supprimer)
    size_bytes  BIGINT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fullcrea_assets_project
    ON fullcrea_assets(project_id);


-- =====================================================
-- 5. fullcrea_clips  (timeline)
-- =====================================================
CREATE TABLE IF NOT EXISTS fullcrea_clips (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL,
    track_index   INTEGER NOT NULL,
    type          TEXT NOT NULL CHECK (type IN ('video', 'audio', 'image', 'text')),
    name          TEXT NOT NULL,
    src           TEXT NOT NULL DEFAULT '',
    start_px      DOUBLE PRECISION NOT NULL,
    width_px      DOUBLE PRECISION NOT NULL CHECK (width_px > 0),
    transform     JSONB,
    text_content  TEXT,
    font_size     INTEGER,
    font_family   TEXT,
    text_color    TEXT,
    FOREIGN KEY (project_id, track_index)
        REFERENCES fullcrea_tracks(project_id, track_index) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fullcrea_clips_project
    ON fullcrea_clips(project_id);
CREATE INDEX IF NOT EXISTS idx_fullcrea_clips_project_track
    ON fullcrea_clips(project_id, track_index);


-- =====================================================
-- 5 bis. MIGRATIONS (colonnes ajoutées après la création des tables)
--    Idempotent : ADD COLUMN IF NOT EXISTS.
-- =====================================================
ALTER TABLE fullcrea_clips
  ADD COLUMN IF NOT EXISTS offset_px          DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (offset_px >= 0),
  ADD COLUMN IF NOT EXISTS source_duration_px DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS volume             DOUBLE PRECISION CHECK (volume IS NULL OR (volume >= 0 AND volume <= 1)),
  ADD COLUMN IF NOT EXISTS muted              BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE fullcrea_tracks
  ADD COLUMN IF NOT EXISTS muted  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE fullcrea_projects
  ADD COLUMN IF NOT EXISTS markers JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Pistes spéciales (Voix Off / Musique / Micro) et voix off générée (texte + voix)
ALTER TABLE fullcrea_tracks
  ADD COLUMN IF NOT EXISTS kind TEXT CHECK (kind IS NULL OR kind IN ('voiceover', 'music', 'mic'));
ALTER TABLE fullcrea_clips
  ADD COLUMN IF NOT EXISTS tts JSONB;

-- Timelines multiples par projet (séquences) et timelines imbriquées :
-- chaque piste et chaque clip appartient à une timeline ; un clip de type
-- 'sequence' référence la timeline qu'il insère.
ALTER TABLE fullcrea_projects
  ADD COLUMN IF NOT EXISTS sequences           JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_sequence_id  TEXT;
ALTER TABLE fullcrea_tracks
  ADD COLUMN IF NOT EXISTS sequence_id TEXT NOT NULL DEFAULT 'seq_main';
ALTER TABLE fullcrea_clips
  ADD COLUMN IF NOT EXISTS sequence_id  TEXT NOT NULL DEFAULT 'seq_main',
  ADD COLUMN IF NOT EXISTS sequence_ref TEXT;

-- Le type 'sequence' s'ajoute aux types de clip existants
DO $$
BEGIN
    ALTER TABLE fullcrea_clips DROP CONSTRAINT IF EXISTS fullcrea_clips_type_check;
    ALTER TABLE fullcrea_clips
        ADD CONSTRAINT fullcrea_clips_type_check
        CHECK (type IN ('video', 'audio', 'image', 'text', 'sequence'));
EXCEPTION WHEN duplicate_object THEN
    NULL; -- déjà appliqué
END $$;

CREATE INDEX IF NOT EXISTS idx_fullcrea_tracks_sequence
    ON fullcrea_tracks(project_id, sequence_id);
CREATE INDEX IF NOT EXISTS idx_fullcrea_clips_sequence
    ON fullcrea_clips(project_id, sequence_id);

-- Montage avancé : vitesse, fondus audio, transition d'entrée, lien vidéo/audio
ALTER TABLE fullcrea_clips
  ADD COLUMN IF NOT EXISTS speed        DOUBLE PRECISION CHECK (speed IS NULL OR (speed > 0 AND speed <= 8)),
  ADD COLUMN IF NOT EXISTS fade_in_px   DOUBLE PRECISION CHECK (fade_in_px  IS NULL OR fade_in_px  >= 0),
  ADD COLUMN IF NOT EXISTS fade_out_px  DOUBLE PRECISION CHECK (fade_out_px IS NULL OR fade_out_px >= 0),
  ADD COLUMN IF NOT EXISTS transition   JSONB,
  ADD COLUMN IF NOT EXISTS link_id      TEXT;

-- Pistes : solo, hauteur personnalisée, repli
ALTER TABLE fullcrea_tracks
  ADD COLUMN IF NOT EXISTS solo      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS height_px INTEGER,
  ADD COLUMN IF NOT EXISTS collapsed BOOLEAN NOT NULL DEFAULT false;


-- =====================================================
-- 5 ter. fullcrea_shares — vidéos partagées (lien public + intégration)
--   La vidéo rendue est déposée dans le bucket public ; cette table donne
--   le lien /v/<id> et le code d'intégration /embed/<id>.
--   Lecture PUBLIQUE (un lien doit s'ouvrir sans compte), écriture réservée
--   au propriétaire.
-- =====================================================
CREATE TABLE IF NOT EXISTS fullcrea_shares (
    id            TEXT PRIMARY KEY,
    user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id    TEXT,
    title         TEXT NOT NULL,
    src           TEXT NOT NULL,
    storage_path  TEXT,
    width         INTEGER NOT NULL DEFAULT 1920 CHECK (width  > 0),
    height        INTEGER NOT NULL DEFAULT 1080 CHECK (height > 0),
    duration_sec  DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fullcrea_shares_user
    ON fullcrea_shares(user_id);

ALTER TABLE fullcrea_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fullcrea_shares_select_public ON fullcrea_shares;
DROP POLICY IF EXISTS fullcrea_shares_insert_own    ON fullcrea_shares;
DROP POLICY IF EXISTS fullcrea_shares_update_own    ON fullcrea_shares;
DROP POLICY IF EXISTS fullcrea_shares_delete_own    ON fullcrea_shares;

-- N'importe qui (y compris anon) peut lire un partage : c'est le principe du lien
CREATE POLICY fullcrea_shares_select_public ON fullcrea_shares
    FOR SELECT USING (true);
CREATE POLICY fullcrea_shares_insert_own ON fullcrea_shares
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY fullcrea_shares_update_own ON fullcrea_shares
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY fullcrea_shares_delete_own ON fullcrea_shares
    FOR DELETE USING (auth.uid() = user_id);

-- Partage EN DIRECT : le lien suit le projet au lieu de pointer un MP4 figé.
-- `live` = true → pas de fichier rendu, le lecteur rejoue la timeline.
ALTER TABLE fullcrea_shares
  ADD COLUMN IF NOT EXISTS live        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sequence_id TEXT;
ALTER TABLE fullcrea_shares ALTER COLUMN src DROP NOT NULL;


-- =====================================================
-- 5 quater. fullcrea_share_payload — lecture publique d'un partage
--   SECURITY DEFINER : la fonction contourne le RLS pour renvoyer le montage
--   d'un partage EN DIRECT, mais uniquement à qui connaît l'id du partage.
--   Les tables du projet restent, elles, privées à leur propriétaire.
-- =====================================================
CREATE OR REPLACE FUNCTION fullcrea_share_payload(share_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'share', jsonb_build_object(
            'id', s.id,
            'title', s.title,
            'live', s.live,
            'src', s.src,
            'width', s.width,
            'height', s.height,
            'durationSec', s.duration_sec,
            'sequenceId', s.sequence_id
        ),
        'updatedAt', CASE WHEN s.live THEN p.updated_at ELSE NULL END,
        'project', CASE WHEN s.live AND p.id IS NOT NULL THEN jsonb_build_object(
            'name', p.name,
            'sequences', p.sequences,
            'activeSequenceId', p.active_sequence_id,
            'settings', jsonb_build_object(
                'width',  COALESCE(ps.width, 1920),
                'height', COALESCE(ps.height, 1080),
                'fps',    COALESCE(ps.fps, 30)
            ),
            'tracks', COALESCE((
                SELECT jsonb_agg(to_jsonb(t) ORDER BY t.track_index)
                FROM fullcrea_tracks t WHERE t.project_id = p.id
            ), '[]'::jsonb),
            'clips', COALESCE((
                SELECT jsonb_agg(to_jsonb(c))
                FROM fullcrea_clips c WHERE c.project_id = p.id
            ), '[]'::jsonb)
        ) ELSE NULL END
    )
    FROM fullcrea_shares s
    LEFT JOIN fullcrea_projects p ON p.id = s.project_id
    LEFT JOIN fullcrea_project_settings ps ON ps.project_id = p.id
    WHERE s.id = share_id;
$$;

-- Le lien doit s'ouvrir sans compte
GRANT EXECUTE ON FUNCTION fullcrea_share_payload(TEXT) TO anon, authenticated;


-- =====================================================
-- 6. ROW LEVEL SECURITY
--   (un user ne voit/écrit que ses propres données)
-- =====================================================
ALTER TABLE fullcrea_projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fullcrea_project_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fullcrea_tracks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fullcrea_assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fullcrea_clips            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fullcrea_projects_select_own ON fullcrea_projects;
DROP POLICY IF EXISTS fullcrea_projects_insert_own ON fullcrea_projects;
DROP POLICY IF EXISTS fullcrea_projects_update_own ON fullcrea_projects;
DROP POLICY IF EXISTS fullcrea_projects_delete_own ON fullcrea_projects;

CREATE POLICY fullcrea_projects_select_own ON fullcrea_projects
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY fullcrea_projects_insert_own ON fullcrea_projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY fullcrea_projects_update_own ON fullcrea_projects
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY fullcrea_projects_delete_own ON fullcrea_projects
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS fullcrea_settings_all_own ON fullcrea_project_settings;
CREATE POLICY fullcrea_settings_all_own ON fullcrea_project_settings
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM fullcrea_projects p
        WHERE p.id = fullcrea_project_settings.project_id
          AND p.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM fullcrea_projects p
        WHERE p.id = fullcrea_project_settings.project_id
          AND p.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS fullcrea_tracks_all_own ON fullcrea_tracks;
CREATE POLICY fullcrea_tracks_all_own ON fullcrea_tracks
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM fullcrea_projects p
        WHERE p.id = fullcrea_tracks.project_id
          AND p.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM fullcrea_projects p
        WHERE p.id = fullcrea_tracks.project_id
          AND p.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS fullcrea_assets_all_own ON fullcrea_assets;
CREATE POLICY fullcrea_assets_all_own ON fullcrea_assets
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM fullcrea_projects p
        WHERE p.id = fullcrea_assets.project_id
          AND p.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM fullcrea_projects p
        WHERE p.id = fullcrea_assets.project_id
          AND p.user_id = auth.uid()
    ));

DROP POLICY IF EXISTS fullcrea_clips_all_own ON fullcrea_clips;
CREATE POLICY fullcrea_clips_all_own ON fullcrea_clips
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM fullcrea_projects p
        WHERE p.id = fullcrea_clips.project_id
          AND p.user_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM fullcrea_projects p
        WHERE p.id = fullcrea_clips.project_id
          AND p.user_id = auth.uid()
    ));


-- =====================================================
-- 7. STORAGE BUCKET pour les médias importés
--    Bucket public pour servir les fichiers facilement.
--    Les écritures restent protégées par RLS.
--    Convention de chemin : <user_id>/<project_id>/<fichier>
-- =====================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('fullcrea-assets', 'fullcrea-assets', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS fullcrea_storage_select_own ON storage.objects;
DROP POLICY IF EXISTS fullcrea_storage_insert_own ON storage.objects;
DROP POLICY IF EXISTS fullcrea_storage_update_own ON storage.objects;
DROP POLICY IF EXISTS fullcrea_storage_delete_own ON storage.objects;

-- Les objets sont publics en lecture (bucket public), pas besoin de policy SELECT.
-- Les écritures restent protégées : un user ne peut uploader que dans son dossier.
CREATE POLICY fullcrea_storage_insert_own ON storage.objects
    FOR INSERT
    WITH CHECK (bucket_id = 'fullcrea-assets'
                AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY fullcrea_storage_update_own ON storage.objects
    FOR UPDATE
    USING (bucket_id = 'fullcrea-assets'
           AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY fullcrea_storage_delete_own ON storage.objects
    FOR DELETE
    USING (bucket_id = 'fullcrea-assets'
           AND auth.uid()::text = (storage.foldername(name))[1]);
