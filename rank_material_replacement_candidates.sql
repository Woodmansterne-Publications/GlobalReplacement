-- One-off ranked replacements for currently pocketed CC materials.
-- The active pocket query is the source of both current pocket counts and the
-- known active, non-dummy material set.
-- ponytail: gold_material has no explicit dummy marker, so zero-pocket catalog
-- rows are excluded until a reliable active/non-dummy predicate is available.

WITH active_assignments AS (
    SELECT DISTINCT
        h.ACCOUNT AS account,
        h.DISPLAY AS display,
        h.REVISION AS revision
    FROM woodmansterne.silver.silver_cardmanager_histhead h
    WHERE h.ACTIVE = 'A'
),
standard_pockets AS (
    SELECT
        d.PREFDESN AS material,
        a.account,
        a.revision,
        CONCAT('STANDARD:', CAST(r.DISPLAY AS STRING)) AS display_key
    FROM active_assignments a
    INNER JOIN woodmansterne.silver.silver_cardmanager_histrack r
        ON r.DISPLAY = a.display
    INNER JOIN woodmansterne.silver.silver_cardmanager_histdets d
        ON d.DISPLAY = r.DISPLAY
       AND d.RACKCODE = r.RACKCODE
),
waitrose_pockets AS (
    SELECT
        wr.Material AS material,
        da.account,
        CAST(NULL AS STRING) AS revision,
        CONCAT('WAITROSE:', da.ref) AS display_key
    FROM woodmansterne.gold.gold_waitrose_display_assignments da
    INNER JOIN woodmansterne.gold.gold_waitrose_racks wr
        ON wr.REF = da.ref
    WHERE da.active_to IS NULL
       OR da.active_to >= CURRENT_DATE()
),
all_pockets AS (
    SELECT material, account, revision, display_key FROM standard_pockets
    UNION ALL
    SELECT material, account, revision, display_key FROM waitrose_pockets
),
normalized_pockets AS (
    SELECT
        REGEXP_REPLACE(material, '(\\d)[A-Za-z]+$', '$1') AS material,
        account,
        revision,
        display_key
    FROM all_pockets
),
material_displays AS (
    SELECT DISTINCT material, display_key
    FROM normalized_pockets
    WHERE display_key IS NOT NULL
),
pocket_counts AS (
    SELECT
        material,
        COUNT(*) AS pocket_count,
        COUNT(DISTINCT account) AS unique_accounts,
        ARRAY_JOIN(COLLECT_SET(revision), ', ') AS revisions,
        ARRAY_JOIN(COLLECT_SET(account), ', ') AS accounts
    FROM normalized_pockets
    GROUP BY material
),
publisher_lookup AS (
    SELECT
        REGEXP_REPLACE(DESIGN, '(\\d)[A-Za-z]+$', '$1') AS material,
        MAX(IMAGFILE) AS imagfile,
        ANY_VALUE(DESIGN) AS design,
        ANY_VALUE(SOURCERF) AS sourcerf,
        COALESCE(
            MAX(CASE WHEN PUBLISHER = 'Woodmansterne' THEN PUBLISHER END),
            ANY_VALUE(PUBLISHER)
        ) AS publisher
    FROM woodmansterne.silver.silver_cardmanager_stckhead
    WHERE PUBLISHER IS NOT NULL
      AND PUBLISHER != ''
    GROUP BY REGEXP_REPLACE(DESIGN, '(\\d)[A-Za-z]+$', '$1')
),
dummy_materials AS (
    SELECT DISTINCT
        REGEXP_REPLACE(DESIGN, '(\\d)[A-Za-z]+$', '$1') AS material
    FROM woodmansterne.silver.silver_cardmanager_stckhead
    WHERE UPPER(TRIM(PUBLISHER)) = 'DUMMY OWNER'
),
material_catalog AS (
    SELECT
        gm.Material_Code AS material,
        gm.PRODUCT AS product,
        gm.PRICE AS price_code,
        NULLIF(TRIM(gm.MINORCAP), '') AS minorcap,
        NULLIF(TRIM(gm.SEASON), '') AS season,
        gm.WIDTH_MM AS width_mm,
        gm.HEIGHTMM AS height_mm,
        NULLIF(TRIM(gm.RANGE), '') AS range_name
    FROM woodmansterne.gold.gold_material gm
    LEFT ANTI JOIN dummy_materials dm
        ON dm.material = REGEXP_REPLACE(gm.Material_Code, '(\\d)[A-Za-z]+$', '$1')
    WHERE gm.PRODUCT = 'CC'
      AND UPPER(gm.Material_Code) NOT RLIKE '^WDM_DUM_'
),
catalog_with_counts AS (
    SELECT
        mc.*,
        pc.pocket_count
    FROM material_catalog mc
    INNER JOIN pocket_counts pc
        ON pc.material = mc.material
),
targets AS (
    SELECT
        c.material,
        pl.design,
        pl.imagfile,
        pl.sourcerf,
        pl.publisher,
        c.pocket_count,
        pc.unique_accounts,
        pc.revisions,
        pc.accounts,
        c.price_code,
        c.minorcap,
        c.season,
        c.width_mm,
        c.height_mm,
        c.range_name
    FROM catalog_with_counts c
    INNER JOIN pocket_counts pc
        ON pc.material = c.material
    INNER JOIN publisher_lookup pl
        ON pl.material = c.material
    WHERE pl.publisher IN (
        'Woodmansterne',
        'Card Mix'
    )
),
price_codes AS (
    SELECT
        material,
        CASE UPPER(TRIM(price_code))
            WHEN 'S' THEN 'GH'
            WHEN 'H' THEN 'HH'
            WHEN 'K' THEN 'HI'
            WHEN 'G' THEN 'II'
            WHEN 'D' THEN 'IJ'
            WHEN 'P' THEN 'JJ'
            WHEN 'Q' THEN 'KK'
            WHEN 'T' THEN 'LL'
            WHEN 'B' THEN 'MM'
            WHEN 'V' THEN 'NN'
            WHEN 'E' THEN 'OO'
            WHEN 'A' THEN 'PP'
            WHEN 'R' THEN 'QQ'
            WHEN 'I' THEN 'RR'
            WHEN 'W' THEN 'SS'
            WHEN 'GH' THEN 'GH'
            WHEN 'HH' THEN 'HH'
            WHEN 'HI' THEN 'HI'
            WHEN 'II' THEN 'II'
            WHEN 'IJ' THEN 'IJ'
            WHEN 'JJ' THEN 'JJ'
            WHEN 'KK' THEN 'KK'
            WHEN 'LL' THEN 'LL'
            WHEN 'MM' THEN 'MM'
            WHEN 'NN' THEN 'NN'
            WHEN 'OO' THEN 'OO'
            WHEN 'PP' THEN 'PP'
            WHEN 'QQ' THEN 'QQ'
            WHEN 'RR' THEN 'RR'
            WHEN 'SS' THEN 'SS'
            ELSE NULL
        END AS double_price_code
    FROM catalog_with_counts
),
priced_materials AS (
    SELECT
        c.*,
        p.double_price_code,
        CASE p.double_price_code
            WHEN 'GH' THEN CAST(2.00 AS DOUBLE)
            WHEN 'HH' THEN CAST(2.50 AS DOUBLE)
            WHEN 'HI' THEN CAST(2.60 AS DOUBLE)
            WHEN 'II' THEN CAST(2.95 AS DOUBLE)
            WHEN 'IJ' THEN CAST(2.95 AS DOUBLE)
            WHEN 'JJ' THEN CAST(3.15 AS DOUBLE)
            WHEN 'KK' THEN CAST(3.40 AS DOUBLE)
            WHEN 'LL' THEN CAST(3.65 AS DOUBLE)
            WHEN 'MM' THEN CAST(3.95 AS DOUBLE)
            WHEN 'NN' THEN CAST(4.20 AS DOUBLE)
            WHEN 'OO' THEN CAST(4.50 AS DOUBLE)
            WHEN 'PP' THEN CAST(4.75 AS DOUBLE)
            WHEN 'QQ' THEN CAST(5.00 AS DOUBLE)
            WHEN 'RR' THEN CAST(5.25 AS DOUBLE)
            WHEN 'SS' THEN CAST(5.50 AS DOUBLE)
            ELSE NULL
        END AS rrp
    FROM catalog_with_counts c
    INNER JOIN price_codes p
        ON p.material = c.material
),
target_prices AS (
    SELECT
        t.*,
        pm.double_price_code,
        pm.rrp
    FROM targets t
    INNER JOIN priced_materials pm
        ON pm.material = t.material
),
candidate_pairs AS (
    SELECT
        t.material AS target_material,
        c.material AS candidate_material,
        c.pocket_count AS candidate_pocket_count,
        t.range_name AS target_range,
        c.range_name AS candidate_range,
        t.price_code AS target_price_code,
        c.price_code AS candidate_price_code,
        t.double_price_code AS target_double_price_code,
        c.double_price_code AS candidate_double_price_code,
        t.rrp AS target_rrp,
        c.rrp AS candidate_rrp
    FROM target_prices t
    INNER JOIN priced_materials c
        ON c.minorcap = t.minorcap
       AND c.season = t.season
       AND c.width_mm <= t.width_mm
       AND c.height_mm <= t.height_mm
       AND c.material != t.material
    WHERE t.minorcap IS NOT NULL
      AND t.season IS NOT NULL
      AND t.width_mm > 0
      AND t.height_mm > 0
      AND c.minorcap IS NOT NULL
      AND c.season IS NOT NULL
      AND c.width_mm > 0
      AND c.height_mm > 0
      AND NOT EXISTS (
          SELECT 1
          FROM material_displays target_display
          INNER JOIN material_displays candidate_display
              ON candidate_display.display_key = target_display.display_key
          WHERE target_display.material = t.material
            AND candidate_display.material = c.material
      )
),
material_tags AS (
    SELECT DISTINCT
        mt.Material AS material,
        tag
    FROM woodmansterne.gold.gold_card_tags mt
    LATERAL VIEW EXPLODE(FROM_JSON(mt.tags, 'ARRAY<STRING>')) exploded_tags AS tag
    WHERE tag IS NOT NULL
),
shared_tags AS (
    SELECT
        p.target_material,
        p.candidate_material,
        SORT_ARRAY(COLLECT_SET(candidate_tag.tag)) AS shared_tags,
        COUNT(DISTINCT candidate_tag.tag) AS shared_tag_count
    FROM candidate_pairs p
    LEFT JOIN material_tags target_tag
        ON target_tag.material = p.target_material
    LEFT JOIN material_tags candidate_tag
        ON candidate_tag.material = p.candidate_material
       AND candidate_tag.tag = target_tag.tag
    GROUP BY p.target_material, p.candidate_material
),
scored_candidates AS (
    SELECT
        p.*,
        COALESCE(p.target_range = p.candidate_range, false) AS same_range,
        CASE
            WHEN p.target_range IS NOT NULL
             AND p.target_range = p.candidate_range
                THEN CAST(100 AS DOUBLE)
            ELSE CAST(1 AS DOUBLE)
        END AS range_factor,
        CASE
            WHEN p.target_rrp IS NOT NULL AND p.candidate_rrp IS NOT NULL
                THEN 10.0 * LEAST(p.target_rrp, p.candidate_rrp)
                    / GREATEST(p.target_rrp, p.candidate_rrp)
            ELSE CAST(1 AS DOUBLE)
        END AS price_factor,
        st.shared_tags,
        COALESCE(st.shared_tag_count, 0) AS shared_tag_count,
        CASE
            WHEN COALESCE(st.shared_tag_count, 0) = 0 THEN CAST(1 AS DOUBLE)
            ELSE 10.0 * COALESCE(st.shared_tag_count, 0)
        END AS tag_factor,
        CAST(p.candidate_pocket_count AS DOUBLE)
            * CASE WHEN p.target_range = p.candidate_range THEN 100.0 ELSE 1.0 END
            * CASE
                WHEN p.target_rrp IS NOT NULL AND p.candidate_rrp IS NOT NULL
                    THEN 10.0 * LEAST(p.target_rrp, p.candidate_rrp)
                        / GREATEST(p.target_rrp, p.candidate_rrp)
                ELSE 1.0
              END
            * CASE
                WHEN COALESCE(st.shared_tag_count, 0) = 0 THEN 1.0
                ELSE 10.0 * COALESCE(st.shared_tag_count, 0)
              END AS score
    FROM candidate_pairs p
    LEFT JOIN shared_tags st
        ON st.target_material = p.target_material
       AND st.candidate_material = p.candidate_material
),
ranked_candidates AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY target_material
            ORDER BY score DESC, candidate_material ASC
        ) AS candidate_rank
    FROM scored_candidates
),
candidate_arrays AS (
    SELECT
        t.material AS target_material,
        TRANSFORM(
            SORT_ARRAY(COLLECT_LIST(
                CASE WHEN r.candidate_material IS NOT NULL THEN NAMED_STRUCT(
                    'candidate_rank', r.candidate_rank,
                    'candidate', NAMED_STRUCT(
                        'material', r.candidate_material,
                        'score', r.score,
                        'score_breakdown', NAMED_STRUCT(
                            'base_pocket_count', r.candidate_pocket_count,
                            'same_range', r.same_range,
                            'range_factor', r.range_factor,
                            'target_price_code', r.target_price_code,
                            'candidate_price_code', r.candidate_price_code,
                            'target_double_price_code', r.target_double_price_code,
                            'candidate_double_price_code', r.candidate_double_price_code,
                            'target_rrp_gbp', r.target_rrp,
                            'candidate_rrp_gbp', r.candidate_rrp,
                            'price_factor', r.price_factor,
                            'shared_tags', r.shared_tags,
                            'tag_factor', r.tag_factor
                        )
                    )
                ) END
            )),
            entry -> entry.candidate
        ) AS Candidates
    FROM targets t
    LEFT JOIN ranked_candidates r
        ON r.target_material = t.material
       AND r.candidate_rank <= 10
    GROUP BY t.material
)
SELECT
    t.material,
    t.design,
    t.imagfile AS IMAGFILE,
    t.sourcerf AS SOURCERF,
    t.publisher,
    t.pocket_count,
    t.unique_accounts,
    t.revisions,
    t.accounts,
    ca.Candidates
FROM targets t
INNER JOIN candidate_arrays ca
    ON ca.target_material = t.material
ORDER BY t.pocket_count DESC, t.material;
