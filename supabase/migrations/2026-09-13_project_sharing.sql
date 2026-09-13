-- Appliquée sur le projet Supabase le 2026-09-13 (voir fullcrea_project_sharing).
-- Partage de projets Gennn CUT : jetons de visualisation / co-édition + membres.
-- Additif uniquement : aucune colonne, table ou politique existante n'est modifiée.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE fullcrea_projects
    ADD COLUMN IF NOT EXISTS view_token TEXT,
    ADD COLUMN IF NOT EXISTS edit_token TEXT;

UPDATE fullcrea_projects SET view_token = encode(gen_random_bytes(16), 'hex') WHERE view_token IS NULL;
UPDATE fullcrea_projects SET edit_token = encode(gen_random_bytes(16), 'hex') WHERE edit_token IS NULL;

ALTER TABLE fullcrea_projects
    ALTER COLUMN view_token SET DEFAULT encode(gen_random_bytes(16), 'hex'),
    ALTER COLUMN edit_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS idx_fullcrea_projects_view_token ON fullcrea_projects(view_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fullcrea_projects_edit_token ON fullcrea_projects(edit_token);

-- ----- Membres (co-éditeurs) -----
CREATE TABLE IF NOT EXISTS fullcrea_project_members (
    project_id  TEXT NOT NULL REFERENCES fullcrea_projects(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_fullcrea_project_members_user ON fullcrea_project_members(user_id);

ALTER TABLE fullcrea_project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fullcrea_members_select_self ON fullcrea_project_members;
CREATE POLICY fullcrea_members_select_self ON fullcrea_project_members
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS fullcrea_members_delete_self ON fullcrea_project_members;
CREATE POLICY fullcrea_members_delete_self ON fullcrea_project_members
    FOR DELETE USING (auth.uid() = user_id);

-- SECURITY DEFINER : contourne RLS pour éviter toute récursion de politiques.
CREATE OR REPLACE FUNCTION fullcrea_is_member(p_project_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM fullcrea_project_members m
        WHERE m.project_id = p_project_id AND m.user_id = auth.uid()
    );
$$;

-- ----- Politiques membres (s'ajoutent aux politiques propriétaire existantes) -----
DROP POLICY IF EXISTS fullcrea_projects_select_member ON fullcrea_projects;
CREATE POLICY fullcrea_projects_select_member ON fullcrea_projects
    FOR SELECT USING (fullcrea_is_member(id));
DROP POLICY IF EXISTS fullcrea_projects_update_member ON fullcrea_projects;
CREATE POLICY fullcrea_projects_update_member ON fullcrea_projects
    FOR UPDATE USING (fullcrea_is_member(id)) WITH CHECK (fullcrea_is_member(id));

DROP POLICY IF EXISTS fullcrea_settings_all_member ON fullcrea_project_settings;
CREATE POLICY fullcrea_settings_all_member ON fullcrea_project_settings
    FOR ALL USING (fullcrea_is_member(project_id)) WITH CHECK (fullcrea_is_member(project_id));

DROP POLICY IF EXISTS fullcrea_tracks_all_member ON fullcrea_tracks;
CREATE POLICY fullcrea_tracks_all_member ON fullcrea_tracks
    FOR ALL USING (fullcrea_is_member(project_id)) WITH CHECK (fullcrea_is_member(project_id));

DROP POLICY IF EXISTS fullcrea_assets_all_member ON fullcrea_assets;
CREATE POLICY fullcrea_assets_all_member ON fullcrea_assets
    FOR ALL USING (fullcrea_is_member(project_id)) WITH CHECK (fullcrea_is_member(project_id));

DROP POLICY IF EXISTS fullcrea_clips_all_member ON fullcrea_clips;
CREATE POLICY fullcrea_clips_all_member ON fullcrea_clips
    FOR ALL USING (fullcrea_is_member(project_id)) WITH CHECK (fullcrea_is_member(project_id));

-- ----- Lecture d'un projet par jeton (lien de visualisation, accessible sans compte) -----
CREATE OR REPLACE FUNCTION fullcrea_project_by_token(p_token TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'ownerId', p.user_id,
        'currentView', p.current_view,
        'updatedAt', p.updated_at,
        'role', CASE WHEN p.edit_token = p_token THEN 'editor' ELSE 'viewer' END,
        'settings', jsonb_build_object(
            'width',  COALESCE(ps.width, 1920),
            'height', COALESCE(ps.height, 1080),
            'fps',    COALESCE(ps.fps, 30)
        ),
        'tracks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', t.track_index, 'type', t.type, 'name', t.name) ORDER BY t.track_index)
            FROM fullcrea_tracks t WHERE t.project_id = p.id
        ), '[]'::jsonb),
        'assets', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type, 'src', a.src))
            FROM fullcrea_assets a WHERE a.project_id = p.id
        ), '[]'::jsonb),
        'clips', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'type', c.type, 'track', c.track_index,
                'start', c.start_px, 'width', c.width_px, 'src', c.src,
                'transform', c.transform, 'text', c.text_content,
                'fontSize', c.font_size, 'fontFamily', c.font_family, 'textColor', c.text_color
            ))
            FROM fullcrea_clips c WHERE c.project_id = p.id
        ), '[]'::jsonb)
    )
    FROM fullcrea_projects p
    LEFT JOIN fullcrea_project_settings ps ON ps.project_id = p.id
    WHERE p_token IS NOT NULL AND length(p_token) >= 16
      AND (p.view_token = p_token OR p.edit_token = p_token)
    LIMIT 1;
$$;

-- ----- Rejoindre un projet via un jeton (compte requis) -----
CREATE OR REPLACE FUNCTION fullcrea_join_project(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_project fullcrea_projects%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Connexion requise';
    END IF;
    IF p_token IS NULL OR length(p_token) < 16 THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_project FROM fullcrea_projects
     WHERE view_token = p_token OR edit_token = p_token
     LIMIT 1;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_project.user_id = v_uid THEN
        RETURN jsonb_build_object('projectId', v_project.id, 'role', 'owner');
    END IF;
    IF v_project.edit_token = p_token THEN
        INSERT INTO fullcrea_project_members (project_id, user_id, role)
        VALUES (v_project.id, v_uid, 'editor')
        ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'editor';
        RETURN jsonb_build_object('projectId', v_project.id, 'role', 'editor');
    END IF;
    RETURN jsonb_build_object('projectId', v_project.id, 'role', 'viewer');
END;
$$;

REVOKE ALL ON FUNCTION fullcrea_project_by_token(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION fullcrea_project_by_token(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION fullcrea_join_project(TEXT) FROM public;
-- Les privilèges par défaut Supabase accordent EXECUTE à anon : on le retire explicitement
REVOKE EXECUTE ON FUNCTION fullcrea_join_project(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fullcrea_join_project(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION fullcrea_is_member(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION fullcrea_is_member(TEXT) TO anon, authenticated;
