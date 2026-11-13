"""Rubric import from CSV and JSON, keeping labels exactly as written."""

from __future__ import annotations

import json

import pytest
from helpers import PACK

from feedbacker_core import cli
from feedbacker_core.models import Rubric
from feedbacker_core.rubric_import import RubricError, import_rubric, shape_of
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
    assert "column 3 header (shape 'Aa') does not read 'Label (points)'" in joined
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


# --- Review fixes: exact labels, corrupt docx, zero weights, JSON shape ---------


def test_grid_labels_kept_exactly_as_written(ws, tmp_path):
    import openpyxl

    path = tmp_path / "g.xlsx"
    wb = openpyxl.Workbook()
    wb.active.append(["", "Very  good\n(75)", "Weak (35)"])
    wb.active.append(["Analysis", "Strong.", "Thin."])
    wb.save(path)
    rubric, _, _ = import_rubric(ws, path)
    assert rubric.criteria[0].levels[0].label == "Very  good\n(75)"
    assert rubric.criteria[0].levels[0].points == 75


def test_corrupt_docx_rubric_fails_cleanly(ws, tmp_path, capsys):
    path = tmp_path / "r.docx"
    path.write_bytes(b"not a docx")
    with pytest.raises(RubricError, match="docx could not be read"):
        import_rubric(ws, path)
    assert cli.main(["rubric", "import", str(ws.path), str(path)]) == 1


def test_zero_weight_override_is_validated_not_ignored(ws):
    with pytest.raises(RubricError, match="greater than 0"):
        import_rubric(ws, PACK / "rubric.csv", weights={"implementation": 0})


@pytest.mark.parametrize(
    "payload,message",
    [
        ("[]", "must be an object"),
        ('{"criteria": "x"}', "'criteria' list"),
        ('{"criteria": [1]}', "criterion 1 must be an object"),
        ('{"criteria": [{"title": "A", "levels": {}}]}', "'levels' list of objects"),
    ],
)
def test_malformed_json_shapes_fail_cleanly(ws, tmp_path, payload, message):
    path = tmp_path / "r.json"
    path.write_text(payload)
    with pytest.raises(RubricError, match=message):
        import_rubric(ws, path)


# --- Named layouts for the level headers (fictional rubrics) ---------------------------------

# A level header lists its marks with the band after it; the same band appears in more than one
# column; the last level is just 0; weights are in the names.
UK_STYLE = [
    ["Criteria", "98, 95, 92 (1st)", "88, 85, 82 (1st)", "78, 75, 72 (1st)", "68,65/62 (2:1)", "38, 35 (fail)", "28, 25, 22 (fail)", "0"],
    ["Research question (25%)", "Outstanding.", "Excellent.", "Very good.", "Good.", "Weak.", "Poor.", "Nothing."],
    ["Method (25.5 %)", "a1", "a2", "a3", "a4", "a5", "a6", "a7"],
    ["Analysis (  30%  )", "b1", "b2", "b3", "b4", "b5", "b6", "b7"],
    ["Presentation (20%) notes", "c1", "c2", "c3", "c4", "c5", "c6", "c7"],
]  # fmt: skip


def _xlsx(path, rows):
    import openpyxl

    wb = openpyxl.Workbook()
    for row in rows:
        wb.active.append(row)
    wb.save(path)
    return path


def _docx(path, *tables):
    from docx import Document

    doc = Document()
    for rows in tables:
        t = doc.add_table(rows=len(rows), cols=len(rows[0]))
        for r, row in enumerate(rows):
            for c, text in enumerate(row):
                t.cell(r, c).text = text
    doc.save(path)
    return path


def test_level_header_of_marks_and_a_band_is_read_with_the_middle_mark_standing_for_the_level(
    ws, tmp_path
):
    rubric, warnings, written = import_rubric(ws, _xlsx(tmp_path / "uk.xlsx", UK_STYLE))
    assert written is False  # previewed, as any grid is
    levels = rubric.criteria[0].levels
    assert [lvl.label for lvl in levels] == UK_STYLE[0][1:]  # as written
    assert [lvl.points for lvl in levels] == [95, 85, 75, 65, 36.5, 25, 0]
    assert [lvl.id for lvl in levels] == ["p95", "p85", "p75", "p65", "p36-5", "p25", "p0"]
    assert warnings == [
        "xlsx: read with the layout 'marks, then an optional band in brackets': a level with "
        "several marks is worth the middle one",
        "xlsx: column 2 '98, 95, 92 (1st)' is worth 95, the middle of its marks 98, 95, 92",
        "xlsx: column 3 '88, 85, 82 (1st)' is worth 85, the middle of its marks 88, 85, 82",
        "xlsx: column 4 '78, 75, 72 (1st)' is worth 75, the middle of its marks 78, 75, 72",
        "xlsx: column 5 '68,65/62 (2:1)' is worth 65, the middle of its marks 68, 65, 62",
        "xlsx: column 6 '38, 35 (fail)' is worth 36.5, the middle of its marks 38, 35",
        "xlsx: column 7 '28, 25, 22 (fail)' is worth 25, the middle of its marks 28, 25, 22",
        "xlsx: column 8 '0' is worth 0",
        "xlsx: row 2 'Research question' is weighted 25, read from '(25%)' in its name",
        "xlsx: row 3 'Method' is weighted 25.5, read from '(25.5%)' in its name",
        "xlsx: row 4 'Analysis' is weighted 30, read from '(30%)' in its name",
    ]
    # A weight is read only at the end of the name; the name keeps what it says otherwise.
    assert [(c.title, c.weight) for c in rubric.criteria] == [
        ("Research question", 25),
        ("Method", 25.5),
        ("Analysis", 30),
        ("Presentation (20%) notes", None),
    ]


def test_a_weight_entered_by_hand_still_wins_over_one_in_a_name(ws, tmp_path):
    rubric, _, _ = import_rubric(
        ws, _xlsx(tmp_path / "uk.xlsx", UK_STYLE), weights={"research-question": 40}
    )
    assert rubric.criteria[0].weight == 40


def test_the_same_layout_is_read_from_a_docx_table_chosen_over_one_that_is_not_a_rubric(
    ws, tmp_path
):
    other = [["Name", "Value"], ["Latency", "120 ms"]]
    rubric, warnings, _ = import_rubric(ws, _docx(tmp_path / "uk.docx", other, UK_STYLE))
    assert [lvl.points for lvl in rubric.criteria[0].levels] == [95, 85, 75, 65, 36.5, 25, 0]
    assert warnings[0].startswith("docx table: read with the layout")


def test_the_plain_label_points_layout_is_read_as_it_was_with_nothing_said_about_it(ws, tmp_path):
    rows = [["", "Excellent (85)", "Good (65)"], ["Analysis (30%)", "Great.", "Fine."]]
    rubric, warnings, _ = import_rubric(ws, _xlsx(tmp_path / "plain.xlsx", rows))
    assert [(lvl.label, lvl.points) for lvl in rubric.criteria[0].levels] == [
        ("Excellent (85)", 85),
        ("Good (65)", 65),
    ]
    # A weight in a name is read in any layout.
    assert warnings == ["xlsx: row 2 'Analysis' is weighted 30, read from '(30%)' in its name"]


def test_a_table_whose_headers_follow_two_layouts_or_none_is_not_read_and_says_what_it_saw(
    ws, tmp_path
):
    mixed = [["", "Good (60)", "78, 75, 72 (1st)", "Odd 1st"], ["Analysis", "a", "b", "c"]]
    with pytest.raises(RubricError) as err:
        import_rubric(ws, _xlsx(tmp_path / "mixed.xlsx", mixed))
    joined = "\n".join(err.value.problems)
    assert "column 3 header (shape '9, 9, 9 (9a)') does not read 'Label (points)'" in joined
    assert "column 4 header (shape 'Aa 9a') does not read 'Label (points)'" in joined
    assert "Odd" not in joined  # what a header says is not repeated (the layouts' own examples are)
    assert (
        "a table is read when every level header follows one layout: 'Label (points)', for "
        "example 'Excellent (85)'; or marks, then an optional band in brackets, for example "
        "'78, 75, 72 (1st)' or '0'" in joined
    )
    assert "The level headers here, by shape: 'Aa (9)', '9, 9, 9 (9a)', 'Aa 9a'" in joined
    unknown = [["", "1st: 70+", "70-100"], ["Analysis", "a", "b"]]
    with pytest.raises(RubricError) as err:
        import_rubric(ws, _xlsx(tmp_path / "none.xlsx", unknown))
    joined = "\n".join(err.value.problems)
    assert "column 2 header (shape '9a: 9+') does not read 'Label (points)'" in joined
    assert "by shape: '9a: 9+', '9-9'" in joined


def test_a_docx_with_no_readable_table_says_how_many_tables_their_sizes_and_header_shapes(
    ws, tmp_path
):
    from docx import Document

    Document().save(tmp_path / "none.docx")
    with pytest.raises(RubricError) as err:
        import_rubric(ws, tmp_path / "none.docx")
    assert "the document has no tables" in err.value.problems[0]
    tables = [
        [["Name", "Value"], ["Latency", "120 ms"]],
        [["Weighting", "1st: 70+", "2:1 (60-69)"], ["a", "b", "c"]],
    ]
    with pytest.raises(RubricError) as err:
        import_rubric(ws, _docx(tmp_path / "some.docx", *tables))
    joined = err.value.problems[0]
    assert (
        "the document has 2 tables: table 1 is 2 rows by 2 columns, its level headers (after the "
        "first column), by shape: 'Aa'; table 2 is 2 rows by 3 columns, its level headers (after "
        "the first column), by shape: '9a: 9+', '9:9 (9-9)'" in joined
    )
    assert "export the rubric as xlsx or csv instead" in joined


def test_a_header_is_described_by_its_shape_never_by_what_it_says():
    assert shape_of("Excellent (85)") == "Aa (9)"
    assert shape_of("78, 75, 72 (1st)") == "9, 9, 9 (9a)"
    assert shape_of("Très bien – ٨٥") == "Aa?a a ? ?"  # anything outside ASCII is one mark


def test_a_header_that_two_layouts_read_differently_is_rejected_not_chosen_by_order(ws, tmp_path):
    # '(1)' is a band for one layout and the points for the other: 75 or 1.
    rows = [["", "78, 75, 72 (1)", "68, 65, 62 (2)"], ["Analysis", "a", "b"]]
    with pytest.raises(RubricError) as err:
        import_rubric(ws, _xlsx(tmp_path / "ambiguous.xlsx", rows))
    joined = "\n".join(err.value.problems)
    assert (
        "column 2 header (shape '9, 9, 9 (9)') can be read two ways, 'Label (points)' makes it "
        "worth 1, but marks, then an optional band in brackets makes it worth 75; change the "
        "header so that only one fits" in joined
    )
    assert "column 3 header (shape '9, 9, 9 (9)') can be read two ways" in joined
    # Where both layouts read the same points, there is nothing to choose between.
    rubric, _, _ = import_rubric(
        ws, _xlsx(tmp_path / "same.xlsx", [["", "50 (50)"], ["Analysis", "a"]]), replace=True
    )
    assert rubric.criteria[0].levels[0].points == 50


def test_a_weight_entered_by_hand_is_what_the_note_says_is_used(ws, tmp_path):
    rows = [["", "Good (60)"], ["Research question (25%)", "a"], ["Method (30%)", "b"]]
    _, warnings, _ = import_rubric(
        ws, _xlsx(tmp_path / "w.xlsx", rows), weights={"research-question": 40}
    )
    assert warnings == [
        "xlsx: row 2 'Research question' has a weight of 25 in its name, but the weight entered, "
        "40, is used",
        "xlsx: row 3 'Method' is weighted 30, read from '(30%)' in its name",
    ]
