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
    "accounts": "ZZZ010, ABB020, ABB020,  , XYZ030",
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
                "tag_factor": 1000000,
            },
        }
    ],
}


class FakeSql:
    def __init__(self) -> None:
        self.merge: tuple[str, dict[str, Any]] | None = None
        self.target_query: tuple[str, dict[str, Any]] | None = None
        self.rack_query: tuple[str, dict[str, Any]] | None = None

    def query(self, statement: str, parameters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        parameters = parameters or {}
        if statement.startswith("MERGE INTO"):
            self.merge = (statement, parameters)
            return []
        if "SELECT material, design, publisher" in statement:
            self.target_query = (statement, parameters)
            return [TARGET]
        if "SELECT * FROM" in statement:
            return [TARGET]
        if "SELECT DISTINCT display_key" in statement:
            self.rack_query = (statement, parameters)
            examples = [{
                "display_key": f"STANDARD:{account}:DISPLAY:1",
                "display_type": "standard",
                "display_ref": "DISPLAY",
                "account": account,
                "revision": "1",
                "rack_code": rack_code,
                "snapshot_at": TARGET["snapshot_at"],
            } for account, rack_code in [
                ("ABB020", "RACK-A"), ("ABB020", "RACK-B"), ("XYZ030", "RACK-C")
            ]]
            if parameters["account"] is not None:
                examples = [row for row in examples if row["account"] == parameters["account"]]
            offset = int(parameters["offset"][0])
            return examples[offset:offset + 2]
        if "SELECT tier, position, material, width_mm, height_mm" in statement:
            return [
                {"tier": 1, "position": 1, "material": "507205", "width_mm": 129, "height_mm": 180},
                {"tier": 1, "position": 3, "material": "517792", "width_mm": 129, "height_mm": 180},
            ]
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
    assert fake_sql.target_query
    assert (
        "ORDER BY pocket_count ASC NULLS LAST, material ASC LIMIT :limit OFFSET :offset"
        in fake_sql.target_query[0]
    )
    assert fake_sql.target_query[1] == {
        "search": "507",
        "pattern": "%507%",
        "limit": (str(main.PAGE_SIZE + 1), "INT"),
        "offset": ("0", "INT"),
    }
    main.get_targets(search=" 507 ", cursor=str(main.PAGE_SIZE))
    assert fake_sql.target_query[1]["search"] == "507"
    assert fake_sql.target_query[1]["pattern"] == "%507%"
    assert fake_sql.target_query[1]["offset"] == (str(main.PAGE_SIZE), "INT")

    candidates = main.get_candidates("507205")
    assert candidates.candidates[0].candidate_rank == 1
    assert candidates.candidates[0].score_breakdown.shared_tags == ["bold text", "typography"]
    assert not hasattr(candidates.candidates[0].score_breakdown, "tag_factor")
    assert candidates.Chosencandidate == "517792"
    assert candidates.target.accounts == ["ABB020", "XYZ030", "ZZZ010"]
    assert main._target({**TARGET, "accounts": None}).accounts == []

    rack_page = main.get_rack_examples("507205", cursor=None)
    rack = rack_page.items[0]
    assert rack.slots[0].is_target
    assert rack.slots[0].width_mm == 129
    assert [slot.position for slot in rack.slots] == [1, 3]
    assert rack.account == "ABB020"
    assert rack_page.previous_cursor is None and rack_page.next_cursor == "1"
    assert fake_sql.rack_query
    statement, parameters = fake_sql.rack_query
    assert "AND (:account IS NULL OR account = :account)" in statement
    assert "ORDER BY display_type, account, display_ref, display_key, rack_code LIMIT 2 OFFSET :offset" in statement
    assert parameters == {"material": "507205", "account": None, "offset": ("0", "INT")}

    account_page = main.get_rack_examples("507205", account="ABB020")
    assert account_page.items[0].rack_code == "RACK-A"
    assert account_page.previous_cursor is None and account_page.next_cursor == "1"
    account_page = main.get_rack_examples("507205", cursor=account_page.next_cursor, account="ABB020")
    assert account_page.items[0].rack_code == "RACK-B"
    assert account_page.previous_cursor == "0" and account_page.next_cursor is None
    assert fake_sql.rack_query[1]["account"] == "ABB020"
    previous_page = main.get_rack_examples("507205", cursor=account_page.previous_cursor, account="ABB020")
    assert previous_page.items[0].rack_code == "RACK-A"
    assert main.get_rack_examples("507205", cursor="2").items[0].account == "XYZ030"
    assert main.get_rack_examples("507205", account="XYZ030").next_cursor is None
    for unavailable_account in ["ZZZ010", "abb020", "ABB020' OR 1=1 --"]:
        empty_page = main.get_rack_examples("507205", account=unavailable_account)
        assert empty_page.items == []
        assert empty_page.previous_cursor is None and empty_page.next_cursor is None
        assert fake_sql.rack_query[1]["account"] == unavailable_account
        assert unavailable_account not in fake_sql.rack_query[0]

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
