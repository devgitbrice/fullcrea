-- =====================================================
-- FULLCREA — Schéma Supabase
-- À exécuter dans : Supabase Dashboard → SQL Editor → Run
-- Idempotent : peut être ré-exécuté sans casse.
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
