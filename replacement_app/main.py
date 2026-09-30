"""Databricks-backed Global Replacement planner API and static-file host."""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.errors.platform import NotFound
from databricks.sdk.service.sql import (
    Disposition,
    ExecuteStatementRequestOnWaitTimeout,
    Format,
    StatementParameterListItem,
)
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
LOG = logging.getLogger(__name__)
PAGE_SIZE = 24
MATERIAL_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
TABLE_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){2}$")
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif")


def table_name(env_name: str, default: str) -> str:
    value = os.getenv(env_name, default)
    if not TABLE_PATTERN.fullmatch(value):
        raise RuntimeError(f"Invalid table identifier in {env_name}")
    return value


RACKS_TABLE = table_name(
    "RACK_SNAPSHOT_TABLE", "woodmansterne.gold.gold_material_replacement_rack_snapshot"
)
RESULTS_VIEW = table_name(
    "RESULTS_VIEW", "woodmansterne.gold.gold_material_replacement_results"
)
DECISIONS_TABLE = table_name(
    "DECISIONS_TABLE", "woodmansterne.gold.gold_material_replacement_decisions"
)
CARDDESIGNS_VOLUME_SETTING = os.getenv(
    "CARDDESIGNS_VOLUME_PATH", "/Volumes/woodmansterne/landing/card_designs"
)
CARDDESIGNS_VOLUME = CARDDESIGNS_VOLUME_SETTING.rstrip("/")


class ProductSummary(BaseModel):
    material: str
    design: str | None = None
    publisher: str | None = None
    pocket_count: int | None = None
    unique_accounts: int | None = None
    image_url: str


class TargetSummary(ProductSummary):
    snapshot_at: str
    Chosencandidate: str | None = None


class ScoreBreakdown(BaseModel):
    base_pocket_count: float | None = None
    same_range: bool | None = None
    range_factor: float | None = None
    target_price_code: str | None = None
    candidate_price_code: str | None = None
    target_double_price_code: str | None = None
    candidate_double_price_code: str | None = None
    target_rrp_gbp: float | None = None
    candidate_rrp_gbp: float | None = None
    price_factor: float | None = None
    shared_tags: list[str] = Field(default_factory=list)
    tag_factor: float | None = None


class Candidate(ProductSummary):
    candidate_rank: int
    score: float
    score_breakdown: ScoreBreakdown


class CandidateResponse(BaseModel):
    target: TargetSummary
    candidates: list[Candidate]
    Chosencandidate: str | None = None


class TargetPage(BaseModel):
    items: list[TargetSummary]
    next_cursor: str | None = None


class RackSlot(BaseModel):
    tier: int | str | None = None
    position: int | str | None = None
    material: str | None = None
    width_mm: float | None = None
    height_mm: float | None = None
    image_url: str | None = None
    is_target: bool = False


class RackExample(BaseModel):
    display_key: str
    display_type: str
    display_ref: str | None = None
    account: str | None = None
    revision: str | None = None
    rack_code: str | None = None
    slots: list[RackSlot]


class RackExamplePage(BaseModel):
    items: list[RackExample]
    previous_cursor: str | None = None
    next_cursor: str | None = None
    snapshot_at: str | None = None


class ChoiceRequest(BaseModel):
    candidate_material: str = Field(min_length=1, max_length=40)


class ChoiceResponse(BaseModel):
    material: str
    Chosencandidate: str


@lru_cache(maxsize=1)
def _workspace_client() -> WorkspaceClient:
    return WorkspaceClient()


class SqlGateway:
    """Small adapter around Databricks SQL Statements API."""

    def __init__(self) -> None:
        self.warehouse_id = os.getenv("SQL_WAREHOUSE_ID", "")

    def query(
        self,
        statement: str,
        parameters: dict[str, str | tuple[str, str]] | None = None,
    ) -> list[dict[str, Any]]:
        if not self.warehouse_id:
            raise HTTPException(status_code=503, detail="SQL_WAREHOUSE_ID is not configured")
        sdk_parameters = []
        for key, raw_value in (parameters or {}).items():
            value, value_type = raw_value if isinstance(raw_value, tuple) else (raw_value, "STRING")
            sdk_parameters.append(
                StatementParameterListItem(name=key, value=value, type=value_type)
            )
        try:
            response = _workspace_client().statement_execution.execute_statement(
                warehouse_id=self.warehouse_id,
                statement=statement,
                wait_timeout="50s",
                on_wait_timeout=ExecuteStatementRequestOnWaitTimeout.CONTINUE,
                disposition=Disposition.INLINE,
                format=Format.JSON_ARRAY,
                parameters=sdk_parameters,
            )
            state = getattr(getattr(response, "status", None), "state", None)
            state = getattr(state, "value", state)
            while state == "PENDING" or state == "RUNNING":
                time.sleep(0.2)
                response = self._client.statement_execution.get_statement(response.statement_id)
                state = getattr(getattr(response, "status", None), "state", None)
                state = getattr(state, "value", state)
            if state not in (None, "SUCCEEDED"):
                message = getattr(getattr(response, "status", None), "error", None)
                raise RuntimeError(getattr(message, "message", "SQL statement failed"))
            schema = getattr(getattr(response, "manifest", None), "schema", None)
            if schema is None:
                return []
            columns = [column.name for column in schema.columns]
            data_array = getattr(getattr(response, "result", None), "data_array", None) or []
            return [dict(zip(columns, row)) for row in data_array]
        except HTTPException:
            raise
        except Exception as exc:
            LOG.exception("Databricks SQL request failed")
            raise HTTPException(status_code=503, detail="Databricks SQL request failed") from exc


sql = SqlGateway()
app = FastAPI(title="Global Replacement", docs_url=None, redoc_url=None, openapi_url=None)
if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


def _offset(cursor: str | None) -> int:
    if cursor is None:
        return 0
    if not cursor.isdecimal() or len(cursor) > 9:
        raise HTTPException(status_code=400, detail="Invalid cursor")
    return int(cursor)


def _material(value: str) -> str:
    if not MATERIAL_PATTERN.fullmatch(value):
        raise HTTPException(status_code=400, detail="Invalid material code")
    return value


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return value
    return value


def _product(row: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    material = str(row.get(f"{prefix}material") or "")
    return {
        "material": material,
        "design": row.get(f"{prefix}design"),
        "publisher": row.get(f"{prefix}publisher"),
        "pocket_count": row.get(f"{prefix}pocket_count"),
        "unique_accounts": row.get(f"{prefix}unique_accounts"),
        "image_url": f"/api/card-designs/{material}" if material else "",
    }


def _target(row: dict[str, Any]) -> TargetSummary:
    return TargetSummary(
        **_product(row),
        snapshot_at=str(row.get("snapshot_at") or ""),
        Chosencandidate=row.get("Chosencandidate"),
    )


def _snapshot_row(material: str) -> dict[str, Any] | None:
    rows = sql.query(
        f"SELECT material, design, publisher, pocket_count, unique_accounts, "
        f"snapshot_at, Chosencandidate, candidates FROM {RESULTS_VIEW} "
        "WHERE material = :material LIMIT 1",
        {"material": material},
    )
    return rows[0] if rows else None


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def home() -> HTMLResponse:
    index = STATIC_DIR / "index.html"
    if not index.is_file():
        return HTMLResponse("Global Replacement frontend is not installed yet.", status_code=503)
    return HTMLResponse(index.read_text(encoding="utf-8"))


@app.get("/api/targets", response_model=TargetPage)
def get_targets(
    search: str = Query(default="", max_length=100),
    cursor: str | None = None,
) -> TargetPage:
    offset = _offset(cursor)
    rows = sql.query(
        f"SELECT material, design, publisher, pocket_count, unique_accounts, snapshot_at, Chosencandidate "
        f"FROM {RESULTS_VIEW} WHERE (:search = '' OR LOWER(material) LIKE LOWER(:pattern) "
        "OR LOWER(COALESCE(design, '')) LIKE LOWER(:pattern) "
        "OR LOWER(COALESCE(publisher, '')) LIKE LOWER(:pattern)) "
        "ORDER BY pocket_count DESC, material LIMIT :limit OFFSET :offset",
        {
            "search": search.strip(),
            "pattern": f"%{search.strip()}%",
            "limit": (str(PAGE_SIZE + 1), "INT"),
            "offset": (str(offset), "INT"),
        },
    )
    has_more = len(rows) > PAGE_SIZE
    page = rows[:PAGE_SIZE]
    items = [_target(row) for row in page]
    return TargetPage(items=items, next_cursor=str(offset + PAGE_SIZE) if has_more else None)


@app.get("/api/targets/{material}/candidates", response_model=CandidateResponse)
def get_candidates(material: str) -> CandidateResponse:
    material = _material(material)
    row = _snapshot_row(material)
    if row is None:
        raise HTTPException(status_code=404, detail="Target material not found in current snapshot")
    choices = _json_value(row.get("candidates")) or []
    candidates = []
    for item in choices:
        item = _json_value(item)
        if not isinstance(item, dict):
            continue
        candidate_material = str(item.get("material") or "")
        product = {
            "material": candidate_material,
            "design": item.get("design"),
            "publisher": item.get("publisher"),
            "pocket_count": item.get("pocket_count"),
            "unique_accounts": item.get("unique_accounts"),
            "image_url": f"/api/card-designs/{candidate_material}",
        }
        candidates.append(
            Candidate(
                **product,
                candidate_rank=int(item.get("candidate_rank") or len(candidates) + 1),
                score=float(item.get("score") or 0),
                score_breakdown=ScoreBreakdown(**(_json_value(item.get("score_breakdown")) or {})),
            )
        )
    chosen = row.get("Chosencandidate")
    return CandidateResponse(target=_target(row), candidates=candidates, Chosencandidate=chosen)


@app.get("/api/targets/{material}/rack-examples", response_model=RackExamplePage)
def get_rack_examples(material: str, cursor: str | None = None) -> RackExamplePage:
    material = _material(material)
    offset = _offset(cursor)
    examples = sql.query(
        f"SELECT DISTINCT display_key, display_type, display_ref, account, revision, rack_code, "
        f"MAX(snapshot_at) AS snapshot_at FROM {RACKS_TABLE} WHERE material = :material "
        "GROUP BY display_key, display_type, display_ref, account, revision, rack_code "
        "ORDER BY display_type, account, display_ref, display_key, rack_code LIMIT 1 OFFSET :offset",
        {"material": material, "offset": (str(offset), "INT")},
    )
    if not examples:
        return RackExamplePage(items=[])
    example = examples[0]
    slots = sql.query(
        f"SELECT tier, position, material, width_mm, height_mm FROM {RACKS_TABLE} "
        "WHERE display_key = :display_key AND rack_code = :rack_code "
        "ORDER BY tier, position",
        {
            "display_key": str(example["display_key"]),
            "rack_code": str(example.get("rack_code") or ""),
        },
    )
    rack = RackExample(
        display_key=str(example["display_key"]),
        display_type=str(example["display_type"]),
        display_ref=example.get("display_ref"),
        account=example.get("account"),
        revision=example.get("revision"),
        rack_code=example.get("rack_code"),
        slots=[
            RackSlot(
                tier=slot.get("tier"),
                position=slot.get("position"),
                material=slot.get("material"),
                width_mm=slot.get("width_mm"),
                height_mm=slot.get("height_mm"),
                image_url=(f"/api/card-designs/{slot['material']}" if slot.get("material") else None),
                is_target=slot.get("material") == material,
            )
            for slot in slots
        ],
    )
    previous_cursor = str(offset - 1) if offset > 0 else None
    next_rows = sql.query(
        f"SELECT display_key, rack_code FROM {RACKS_TABLE} WHERE material = :material "
        "GROUP BY display_key, rack_code "
        "ORDER BY display_key, rack_code LIMIT 1 OFFSET :offset",
        {"material": material, "offset": (str(offset + 1), "INT")},
    )
    return RackExamplePage(
        items=[rack],
        previous_cursor=previous_cursor,
        next_cursor=str(offset + 1) if next_rows else None,
        snapshot_at=str(example.get("snapshot_at") or "") or None,
    )


def _read_card_design(material: str) -> tuple[bytes, str] | None:
    for extension in IMAGE_EXTENSIONS:
        volume_path = f"{CARDDESIGNS_VOLUME}/{material}{extension}"
        try:
            download = _workspace_client().files.download(volume_path)
            with download.contents as image_file:
                image_bytes = image_file.read()
            return image_bytes, extension
        except NotFound:
            continue
        except Exception as exc:
            LOG.exception(
                "Card artwork Volume read failed: material=%s path=%s",
                material,
                volume_path,
            )
            raise HTTPException(
                status_code=502,
                detail="Card artwork storage is unavailable",
            ) from exc

    LOG.warning(
        "Card artwork not found in Unity Catalog Volume: material=%s volume=%s",
        material,
        CARDDESIGNS_VOLUME,
    )
    return None


@app.get("/api/card-designs/{material}")
def get_card_design(material: str) -> Response:
    material = _material(material)
    image = _read_card_design(material)
    if image is None:
        raise HTTPException(status_code=404, detail="Card artwork is not available")
    image_bytes, extension = image
    return Response(
        content=image_bytes,
        media_type=mimetypes.guess_type(f"{material}{extension}")[0] or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.put("/api/targets/{material}/choice", response_model=ChoiceResponse)
def save_choice(material: str, request: ChoiceRequest) -> ChoiceResponse:
    material = _material(material)
    candidate = _material(request.candidate_material)
    row = _snapshot_row(material)
    if row is None:
        raise HTTPException(status_code=404, detail="Target material not found in current snapshot")
    available = _json_value(row.get("candidates")) or []
    valid_codes = {
        str(item.get("material"))
        for raw in available
        if isinstance((item := _json_value(raw)), dict)
    }
    if candidate not in valid_codes:
        raise HTTPException(status_code=422, detail="Candidate is not in the target's current candidate list")
    sql.query(
        f"MERGE INTO {DECISIONS_TABLE} AS target "
        "USING (SELECT :target_material AS target_material, "
        ":candidate_material AS candidate_material) AS source "
        "ON target.target_material = source.target_material "
        "WHEN MATCHED THEN UPDATE SET candidate_material = source.candidate_material, "
        "decided_at = CURRENT_TIMESTAMP(), decided_by = CURRENT_USER() "
        "WHEN NOT MATCHED THEN INSERT (target_material, candidate_material, decided_at, decided_by) "
        "VALUES (source.target_material, source.candidate_material, CURRENT_TIMESTAMP(), CURRENT_USER())",
        {"target_material": material, "candidate_material": candidate},
    )
    return ChoiceResponse(material=material, Chosencandidate=candidate)
