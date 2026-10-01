"""Small offline API contract check; run with ``python verify_local.py``."""

from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import main
from databricks.sdk.errors.platform import NotFound


TARGET = {
    "material": "507205",
    "design": "507205",
    "publisher": "Woodmansterne",
    "pocket_count": 2248,
    "unique_accounts": 976,
    "snapshot_at": "2026-09-29T10:00:00Z",
    "Chosencandidate": "517792",
    "candidates": [
        {
            "candidate_rank": 1,
            "material": "517792",
            "design": "517792",
            "publisher": "Woodmansterne",
            "pocket_count": 1228,
            "unique_accounts": 500,
            "score": 12280000000,
            "score_breakdown": {
                "base_pocket_count": 1228,
                "same_range": True,
                "range_factor": 100,
                "shared_tags": ["bold text", "typography"],
            },
        }
    ],
}


class FakeSql:
    def __init__(self) -> None:
        self.merge: tuple[str, dict[str, Any]] | None = None

    def query(self, statement: str, parameters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        parameters = parameters or {}
        if statement.startswith("MERGE INTO"):
            self.merge = (statement, parameters)
            return []
        if "SELECT material, design, publisher" in statement:
            return [TARGET]
        if "SELECT * FROM" in statement:
            return [TARGET]
        if "SELECT DISTINCT display_key" in statement:
            return [{
                "display_key": "STANDARD:ACCOUNT:DISPLAY:1",
                "display_type": "standard",
                "display_ref": "DISPLAY",
                "account": "ACCOUNT",
                "revision": "1",
                "rack_code": "RACK-A",
                "snapshot_at": TARGET["snapshot_at"],
            }]
        if "SELECT tier, position, material, width_mm, height_mm" in statement:
            return [
                {"tier": 1, "position": 1, "material": "507205", "width_mm": 129, "height_mm": 180},
                {"tier": 1, "position": 3, "material": "517792", "width_mm": 129, "height_mm": 180},
            ]
        if "SELECT display_key, rack_code" in statement:
            return []
        raise AssertionError(f"Unexpected SQL: {statement}")


def main_check() -> None:
    fake_sql = FakeSql()
    main.sql = fake_sql

    page = main.home()
    page_html = page.body.decode("utf-8")
    assert page.status_code == 200 and 'type="text/babel"' in page_html

    targets = main.get_targets(search="507", cursor=None)
    assert targets.items[0].material == "507205"
    assert targets.items[0].Chosencandidate == "517792"

    candidates = main.get_candidates("507205")
    assert candidates.candidates[0].candidate_rank == 1
    assert candidates.candidates[0].score_breakdown.shared_tags == ["bold text", "typography"]
    assert candidates.Chosencandidate == "517792"

    rack_page = main.get_rack_examples("507205", cursor=None)
    rack = rack_page.items[0]
    assert rack.slots[0].is_target
    assert rack.slots[0].width_mm == 129
    assert [slot.position for slot in rack.slots] == [1, 3]

    try:
        main.save_choice("507205", main.ChoiceRequest(candidate_material="999999"))
    except main.HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("An invalid candidate was accepted")
    assert fake_sql.merge is None

    saved = main.save_choice("507205", main.ChoiceRequest(candidate_material="517792"))
    assert saved.Chosencandidate == "517792"
    assert fake_sql.merge
    assert fake_sql.merge[1] == {
        "target_material": "507205",
        "candidate_material": "517792",
    }

    def download(volume_path: str) -> SimpleNamespace:
        if volume_path == f"{main.CARDDESIGNS_VOLUME}/507205.jpg":
            return SimpleNamespace(contents=BytesIO(b"test image"))
        raise NotFound("Missing test artwork")

    main._workspace_client = lambda: SimpleNamespace(files=SimpleNamespace(download=download))
    served = main.get_card_design("507205")
    assert served.body == b"test image" and served.media_type == "image/jpeg"
    try:
        main.get_card_design("999999")
    except main.HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("Missing artwork did not return 404")

    print("Local API contract check passed.")


if __name__ == "__main__":
    main_check()
