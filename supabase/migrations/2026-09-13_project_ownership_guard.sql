-- Appliquée sur le projet Supabase le 2026-09-13 (fullcrea_project_ownership_guard).
-- Un co-éditeur peut mettre à jour la ligne projet (nom, timelines…) mais ne
-- doit jamais pouvoir s'approprier le projet ni faire tourner ses jetons.

CREATE OR REPLACE FUNCTION fullcrea_guard_project_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF (NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.view_token IS DISTINCT FROM OLD.view_token
        OR NEW.edit_token IS DISTINCT FROM OLD.edit_token)
       AND auth.uid() IS NOT NULL
       AND auth.uid() <> OLD.user_id THEN
        RAISE EXCEPTION 'Seul le propriétaire peut modifier la propriété ou les jetons du projet';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fullcrea_projects_ownership ON fullcrea_projects;
CREATE TRIGGER trg_fullcrea_projects_ownership
    BEFORE UPDATE ON fullcrea_projects
    FOR EACH ROW EXECUTE FUNCTION fullcrea_guard_project_ownership();
