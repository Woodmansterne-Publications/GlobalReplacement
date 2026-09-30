-- Run once as a Unity Catalog schema/table owner before deploying the app.
CREATE TABLE IF NOT EXISTS woodmansterne.gold.gold_material_replacement_decisions (
    target_material STRING NOT NULL,
    candidate_material STRING NOT NULL,
    decided_at TIMESTAMP NOT NULL,
    decided_by STRING
)
USING DELTA;

-- This is the app-facing result contract. Keep the output alias casing exact.
CREATE OR REPLACE VIEW woodmansterne.gold.gold_material_replacement_results AS
SELECT
    candidates.*,
    decisions.candidate_material AS `Chosencandidate`,
    decisions.decided_at,
    decisions.decided_by
FROM woodmansterne.gold.gold_material_replacement_candidates_snapshot candidates
LEFT JOIN woodmansterne.gold.gold_material_replacement_decisions decisions
    ON decisions.target_material = candidates.material;

-- Example parameterized statement for the API save operation. The API must
-- validate candidate_material against the current snapshot's candidates array
-- before executing this statement, and bind target_material/candidate_material.
--
-- MERGE INTO woodmansterne.gold.gold_material_replacement_decisions AS target
-- USING (
--     SELECT
--         :target_material AS target_material,
--         :candidate_material AS candidate_material,
--         CURRENT_TIMESTAMP() AS decided_at,
--         CURRENT_USER() AS decided_by
-- ) AS source
-- ON target.target_material = source.target_material
-- WHEN MATCHED THEN UPDATE SET
--     target.candidate_material = source.candidate_material,
--     target.decided_at = source.decided_at,
--     target.decided_by = source.decided_by
-- WHEN NOT MATCHED THEN INSERT (
--     target_material, candidate_material, decided_at, decided_by
-- ) VALUES (
--     source.target_material, source.candidate_material,
--     source.decided_at, source.decided_by
-- );
