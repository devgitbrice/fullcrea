-- Diagnostic de récupération — à exécuter dans le SQL Editor de Supabase.
-- Répond à une seule question : le montage est-il encore en base ?

-- 1. Combien de pistes et de clips par projet ?
SELECT p.id,
       p.name,
       (SELECT count(*) FROM fullcrea_tracks t WHERE t.project_id = p.id) AS pistes,
       (SELECT count(*) FROM fullcrea_clips  c WHERE c.project_id = p.id) AS clips,
       (SELECT count(*) FROM fullcrea_assets a WHERE a.project_id = p.id) AS fichiers
FROM fullcrea_projects p
ORDER BY p.created_at;

-- 2. Répartition des clips par timeline (sequence_id) et timelines déclarées
--    dans les métadonnées du projet. Un sequence_id présent ici mais absent de
--    la colonne `sequences` était ignoré par l'éditeur : il est désormais
--    récupéré automatiquement sous le nom « Timeline récupérée N ».
SELECT c.project_id,
       coalesce(c.sequence_id, 'seq_main') AS timeline,
       count(*) AS clips
FROM fullcrea_clips c
GROUP BY 1, 2
ORDER BY 1, 2;

SELECT id, name, sequences, active_sequence_id FROM fullcrea_projects;

-- 3. Si les comptes de l'étape 1 sont à zéro, le montage n'est plus en base :
--    il faut le restaurer depuis une sauvegarde (Database > Backups, ou PITR).
--    Les fichiers importés (bucket de stockage) ne sont jamais supprimés par
--    la sauvegarde du projet : seules les lignes de montage sont concernées.
