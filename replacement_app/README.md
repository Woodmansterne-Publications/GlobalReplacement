# Global Replacement

Databricks app source for the global material replacement planner. The app reads refreshed Unity Catalog snapshots and writes only the current shared choice to `woodmansterne.gold.gold_material_replacement_decisions`.

## Deploy

1. In a SQL warehouse, run `sql/refresh_snapshots.sql` and `sql/refresh_rack_snapshot.sql` as an operator with access to their source tables. These are manual refreshes; the app does not run them.
2. Run `sql/setup_decisions.sql` once after the candidate snapshot exists. It creates the Delta decision table and the `gold_material_replacement_results` view.
3. Set the `sql_warehouse_id` bundle variable to an existing warehouse ID, then deploy from this directory with `databricks bundle deploy --var="sql_warehouse_id=<warehouse-id>"`. The bundle binds the warehouse, read-only card-design Volume, read-only snapshots and result view, and the decision table with `SELECT` plus `MODIFY` only.
4. Grant intended planners `CAN USE` on the Databricks app. Its service principal performs all decision writes, so choices are shared among app users.

## Local verification

Run `python verify_local.py` from this directory for an offline API contract check covering snapshot parsing, rack slots, choice validation/MERGE parameters, and artwork lookup/fallback.

`app.yaml` starts one Uvicorn process on `0.0.0.0:${DATABRICKS_APP_PORT}`. The card design resource resolves to `/Volumes/woodmansterne/landing/card_designs`. The app looks up images by material code and should show a labeled fallback when no supported image file exists.

## Snapshot contracts

`gold_material_replacement_candidates_snapshot` contains one row per target material, including targets with no candidates. It preserves the ranking query's top ten order and full score breakdown, and enriches each candidate with design, publisher, pocket/account counts, source references, and image filename. Candidate and target rows contain `snapshot_at`.

`gold_material_replacement_rack_snapshot` contains one row per physical slot. `display_key` groups slots into a browsable rack example; `display_type` is `standard` or `waitrose`. Standard CardManager slots use `histdets.TIER` and `histdets.POSITION` and retain `histrack.RACKCODE`. Waitrose slots use `gold_vw_waitrose_rack_latest`'s `REF`, `RACKCODE`, `TIER`, `POSITION`, `Material`, and card dimensions. The snapshot includes card width/height for proportionate rendering and `snapshot_at`.

`gold_material_replacement_decisions` stores one current choice per `target_material`. The app validates the proposed candidate against that target's current snapshot candidates before a parameterized SQL `MERGE`; later choices overwrite the current row. `gold_material_replacement_results` joins the current choice into the target snapshot as the exact column alias `Chosencandidate`.

## Source assumptions

- The ranking SQL is the production source. The attached three-row CSV is only a sample shape; its UNC `IMAGFILE` values are not used as production artwork paths.
- Card design files are named from their material code and use a supported image extension in the bound Volume.
- The Waitrose latest rack view exposes `REF`, `RACKCODE`, `TIER`, `POSITION`, and `Material`. `gold_waitrose_display_assignments` supplies active account metadata by `ref`.
- CardManager slot placement is held in `silver_cardmanager_histdets.TIER` and `.POSITION`; `silver_cardmanager_histrack.POSITION` is not needed for per-card placement.
- Snapshot refresh uses `CREATE OR REPLACE TABLE`. Run both refresh scripts after source updates; each table's `snapshot_at` indicates its own completed refresh time.

The app bundle expects the snapshot tables, decision table, result view, Volume, and SQL warehouse to exist. The app service principal receives `CAN USE` on the warehouse, `READ_VOLUME` on the image Volume, `SELECT` on read resources, and `SELECT`/`MODIFY` on the decision table. It does not receive write access to either snapshot or source table.
