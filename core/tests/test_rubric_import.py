"""Rubric import from CSV and JSON, keeping labels exactly as written."""

from __future__ import annotations

import json

import pytest
from helpers import PACK

from feedbacker_core import cli
from feedbacker_core.models import Rubric
from feedbacker_core.rubric_import import RubricError, import_rubric
from feedbacker_core.workspace import Workspace, WorkspaceError


@pytest.fixture
def ws(tmp_path):
    return Workspace.create("mod-1", root=tmp_path)


def test_csv_import_matches_points_based_rubric(ws):
    rubric, warnings, _ = import_rubric(ws, PACK / "rubric.csv", title="Synthetic rubric")
    assert [c.id for c in rubric.criteria] == [
        "requirements-and-design",
        "implementation",
        "testing-and-evaluation",
        "reflection-and-professional-practice",
    ]
    testing = rubric.criteria[2]
    assert testing.weight == 25 and testing.max_points == 100 and len(testing.levels) == 9
    level_68 = next(lvl for lvl in testing.levels if lvl.points == 68)
    assert level_68.label == "2:2 (68)"  # inconsistent label kept exactly
    assert level_68.id == "p68"
    assert rubric.criteria[0].description == "• requirements\n• design justification"
    assert warnings == [
        "criterion 1 ('Requirements and design'): literal '\\n' sequences converted to line breaks"
    ]
    assert Rubric.model_validate(ws.read_json("rubric.json")) == rubric
    assert ws.read_json("rubric-warnings.json") == warnings


def test_json_import(ws, tmp_path):
    path = tmp_path / "r.json"
    path.write_text(
        json.dumps(
            {
                "title": "Fictional",
                "criteria": [
                    {
                        "title": "Analysis",
                        "weight": 50,
                        "levels": [
                            {"label": "1ST (85)", "points": 85, "descriptor": "Excellent."},
                            {"label": "FAIL (20)", "points": 20, "descriptor": "Weak."},
                        ],
                    },
                ],
            }
        )
    )
    rubric, warnings, _ = import_rubric(ws, path)
    assert rubric.title == "Fictional" and warnings == []
    assert [lvl.id for lvl in rubric.criteria[0].levels] == ["p85", "p20"]


def test_all_problems_reported_together(ws, tmp_path):
    path = tmp_path / "r.csv"
    path.write_text(
        "criterion,level_label,points,descriptor\n"
        "Analysis,1ST (85),eighty,Excellent.\n"
        "Analysis,,40,Weak.\n"
        "Design,2:1 (65),65,\n"
    )
    with pytest.raises(RubricError) as err:
        import_rubric(ws, path)
    joined = "\n".join(err.value.problems)
    assert "'eighty' is not a number" in joined
    assert "label is empty" in joined
    assert "descriptor is empty" in joined
    assert not ws.exists("rubric.json")


def test_missing_columns_and_bad_types(ws, tmp_path):
    bad = tmp_path / "r.csv"
    bad.write_text("criterion,points\nA,1\n")
    with pytest.raises(RubricError, match="missing column"):
        import_rubric(ws, bad)
    other = tmp_path / "r.odt"
    other.write_bytes(b"")
    with pytest.raises(RubricError, match="use .csv, .json, .xlsx, or .docx"):
        import_rubric(ws, other)


def test_replace_guard_and_cli(ws, capsys):
    assert cli.main(["rubric", "import", str(ws.path), str(PACK / "rubric.csv")]) == 0
    assert "4 criteria" in capsys.readouterr().out
    with pytest.raises(WorkspaceError, match="already imported"):
        import_rubric(ws, PACK / "rubric.csv")
    import_rubric(ws, PACK / "rubric.csv", replace=True)


# --- Grid rubrics (xlsx and docx tables) ---------------------------------------


@pytest.mark.parametrize("name", ["rubric-grid.xlsx", "rubric-grid.docx"])
def test_grid_import_previews_until_confirmed(ws, name):
    rubric, warnings, written = import_rubric(ws, PACK / name, title="Grid")
    assert not written and not ws.exists("rubric.json")
    assert len(rubric.criteria) == 4 and warnings == []
    first = rubric.criteria[0]
    assert first.title == "Requirements and design"
    assert first.description.startswith("• Identifies requirements")
    assert [lvl.label for lvl in first.levels][:2] == ["Exceptional (100)", "Excellent (85)"]
    assert [lvl.points for lvl in first.levels] == [100, 85, 75, 65, 55, 45, 35, 15, 0]
    assert [lvl.id for lvl in first.levels][-1] == "p0"
    rubric2, _, written = import_rubric(ws, PACK / name, title="Grid", confirm=True)
    assert written and Rubric.model_validate(ws.read_json("rubric.json")) == rubric2


def test_grid_weights_applied_and_unknown_rejected(ws):
    rubric, _, _ = import_rubric(
        ws, PACK / "rubric-grid.xlsx", weights={"implementation": 25, "requirements-and-design": 25}
    )
    assert [c.weight for c in rubric.criteria[:2]] == [25, 25]
    with pytest.raises(RubricError, match="weight given for unknown criterion 'nope'"):
        import_rubric(ws, PACK / "rubric-grid.xlsx", weights={"nope": 10})


def test_grid_header_problems_are_listed(ws, tmp_path):
    import openpyxl

    path = tmp_path / "bad.xlsx"
    wb = openpyxl.Workbook()
    wb.active.append(["", "Excellent (85)", "Good", "Weak (35)"])
    wb.active.append(["Analysis", "Great.", "Fine.", ""])
    wb.save(path)
    with pytest.raises(RubricError) as err:
        import_rubric(ws, path)
    joined = "\n".join(err.value.problems)
    assert "column 3 header 'Good' does not read 'Label (points)'" in joined
    assert "descriptor is empty" in joined


def test_docx_without_grid_table_explains_itself(ws, tmp_path):
    from helpers import docx_with_table

    with pytest.raises(RubricError, match="no rubric grid table found"):
        import_rubric(ws, docx_with_table(tmp_path / "t.docx"))


def test_cli_grid_preview_then_confirm(ws, capsys):
    path = str(PACK / "rubric-grid.xlsx")
    assert cli.main(["rubric", "import", str(ws.path), path, "--weight", "implementation=25"]) == 0
    out = capsys.readouterr().out
    assert "preview of rubric" in out and "re-run with --confirm" in out
    assert "weight 25%" in out and not ws.exists("rubric.json")
    assert cli.main(["rubric", "import", str(ws.path), path, "--confirm"]) == 0
    assert "imported rubric" in capsys.readouterr().out and ws.exists("rubric.json")
    assert cli.main(["rubric", "import", str(ws.path), path, "--weight", "x"]) == 1
