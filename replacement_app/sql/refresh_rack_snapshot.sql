-- Operator-run refresh. This is deliberately separate from app request handling.
-- CardManager detail rows hold the physical tier and pocket position; track
-- rows hold the rack position for ordering rack examples within a display.

CREATE OR REPLACE TABLE woodmansterne.gold.gold_material_replacement_rack_snapshot
USING DELTA
AS
WITH active_standard AS (
    SELECT DISTINCT
        h.ACCOUNT AS account,
        h.DISPLAY AS display,
        h.REVISION AS revision
    FROM woodmansterne.silver.silver_cardmanager_histhead h
    WHERE h.ACTIVE = 'A'
),
standard_slots AS (
    SELECT DISTINCT
        CONCAT(
            'STANDARD:', CAST(a.account AS STRING), ':',
            CAST(a.display AS STRING), ':', CAST(a.revision AS STRING)
        ) AS display_key,
        'standard' AS display_type,
        CAST(a.display AS STRING) AS display_ref,
        CAST(a.account AS STRING) AS account,
        CAST(a.revision AS STRING) AS revision,
        CAST(r.RACKCODE AS STRING) AS rack_code,
        CAST(d.TIER AS INT) AS tier,
        CAST(d.POSITION AS INT) AS position,
        REGEXP_REPLACE(d.PREFDESN, '(\\d)[A-Za-z]+$', '$1') AS material,
        CAST(gm.WIDTH_MM AS DOUBLE) AS width_mm,
        CAST(gm.HEIGHTMM AS DOUBLE) AS height_mm
    FROM active_standard a
    INNER JOIN woodmansterne.silver.silver_cardmanager_histrack r
        ON r.DISPLAY = a.display
    INNER JOIN woodmansterne.silver.silver_cardmanager_histdets d
        ON d.DISPLAY = r.DISPLAY
       AND d.RACKCODE = r.RACKCODE
    LEFT JOIN woodmansterne.gold.gold_material gm
        ON gm.Material_Code = REGEXP_REPLACE(d.PREFDESN, '(\\d)[A-Za-z]+$', '$1')
    WHERE d.PREFDESN IS NOT NULL
      AND d.TIER IS NOT NULL
      AND d.POSITION IS NOT NULL
),
active_waitrose AS (
    SELECT DISTINCT
        da.ref,
        CAST(da.account AS STRING) AS account
    FROM woodmansterne.gold.gold_waitrose_display_assignments da
    WHERE da.active_from <= CURRENT_DATE()
      AND (da.active_to IS NULL OR da.active_to >= CURRENT_DATE())
),
waitrose_slots AS (
    SELECT DISTINCT
        CONCAT('WAITROSE:', CAST(w.REF AS STRING)) AS display_key,
        'waitrose' AS display_type,
        CAST(w.REF AS STRING) AS display_ref,
        aw.account,
        CAST(NULL AS STRING) AS revision,
        CAST(w.RACKCODE AS STRING) AS rack_code,
        CAST(w.TIER AS INT) AS tier,
        CAST(w.POSITION AS INT) AS position,
        REGEXP_REPLACE(CAST(w.Material AS STRING), '(\\d)[A-Za-z]+$', '$1') AS material,
        CAST(w.Card_Width_MM AS DOUBLE) AS width_mm,
        CAST(w.Card_Height_MM AS DOUBLE) AS height_mm
    FROM woodmansterne.gold.gold_vw_waitrose_rack_latest w
    INNER JOIN active_waitrose aw
        ON aw.ref = w.REF
    WHERE w.Material IS NOT NULL
      AND w.TIER IS NOT NULL
      AND w.POSITION IS NOT NULL
),
all_slots AS (
    SELECT * FROM standard_slots
    UNION ALL
    SELECT * FROM waitrose_slots
),
snapshot_metadata AS (
    SELECT CURRENT_TIMESTAMP() AS snapshot_at
)
SELECT
    s.display_key,
    s.display_type,
    s.display_ref,
    s.account,
    s.revision,
    s.rack_code,
    s.tier,
    s.position,
    s.material,
    s.width_mm,
    s.height_mm,
    m.snapshot_at
FROM all_slots s
CROSS JOIN snapshot_metadata m;
