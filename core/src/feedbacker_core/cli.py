"""Command-line entry for Stage 0 tasks that precede the UI.

    feedbacker workspace create NAME [--root DIR] [--retention-days N] [--retention-source TEXT]
    feedbacker request record WORKSPACE --sample BAND:ID[,ID...] ... [options]
    feedbacker request show WORKSPACE
    feedbacker inspect FILE
    feedbacker originals import WORKSPACE SOURCE [SOURCE ...] [--replace]
    feedbacker rubric import WORKSPACE FILE [--title T] [--version V] [--weight ID=PCT ...]
        [--sheet NAME] [--confirm] [--replace]
            FILE is .csv or .json (written directly), or a grid .xlsx or .docx
            table (previewed; written only with --confirm)

``request show`` prints the pseudonymous request only, and ``inspect`` prints
structure only. Neither ever prints external identifiers, names, or document
text.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from feedbacker_core.extract import ExtractionError
from feedbacker_core.models import BandCount
from feedbacker_core.originals import ImportProblem, import_originals
from feedbacker_core.request import RequestError, SampleEntry, load_request, record_request
from feedbacker_core.rubric_import import RubricError, import_rubric
from feedbacker_core.structure import InspectionError, inspect_path
from feedbacker_core.workspace import DEFAULT_ROOT, Workspace, WorkspaceError


def parse_sample(values: list[str]) -> list[SampleEntry]:
    """Parse ``BAND:ID,ID`` or ``ID,ID`` (no band) arguments."""
    entries: list[SampleEntry] = []
    for value in values:
        band, sep, ids = value.rpartition(":")
        if not sep:
            band, ids = "", value
        entries += [SampleEntry(external_id=i, band=band or None) for i in ids.split(",")]
    return entries


def parse_bands(values: list[str]) -> list[BandCount]:
    bands: list[BandCount] = []
    for value in values:
        label, sep, count = value.rpartition("=")
        if not sep or not label.strip() or not count.strip().isdigit():
            raise RequestError([f"band '{value}' must look like LABEL=COUNT, e.g. 60-69=2"])
        bands.append(BandCount(label=label.strip(), count=int(count)))
    return bands


def parse_weights(values: list[str]) -> dict[str, float]:
    weights: dict[str, float] = {}
    for value in values:
        cid, sep, pct = value.rpartition("=")
        try:
            weights[cid.strip()] = float(pct.strip().rstrip("%"))
        except ValueError:
            cid = ""
        if not sep or not cid.strip():
            raise RubricError([f"weight '{value}' must look like CRITERION_ID=PERCENT"])
    return weights


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="feedbacker", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    ws = sub.add_parser("workspace", help="manage moderation workspaces")
    ws_sub = ws.add_subparsers(dest="action", required=True)
    create = ws_sub.add_parser("create", help="create a workspace outside any git repository")
    create.add_argument("name")
    create.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    create.add_argument("--retention-days", type=int, default=90)
    create.add_argument("--retention-source", default="default")

    req = sub.add_parser("request", help="record the moderation request")
    req_sub = req.add_subparsers(dest="action", required=True)
    rec = req_sub.add_parser("record", help="record context and sampled submissions")
    rec.add_argument("workspace", type=Path)
    rec.add_argument(
        "--sample",
        action="append",
        required=True,
        metavar="BAND:ID[,ID...]",
        help="sampled identifiers, optionally prefixed by the band they were listed under; repeatable",
    )
    rec.add_argument("--programme", help="programme title, as written on the request")
    rec.add_argument("--module", help="module title and code, as written on the request")
    rec.add_argument(
        "--staff-role",
        action="append",
        default=[],
        help="a staff role involved, e.g. 'module convener'; never a name; repeatable",
    )
    rec.add_argument("--cohort-size", type=int)
    groups = rec.add_mutually_exclusive_group()
    groups.add_argument("--multiple-groups", dest="multiple_groups", action="store_true")
    groups.add_argument("--single-group", dest="multiple_groups", action="store_false")
    rec.set_defaults(multiple_groups=None)
    rec.add_argument("--band", action="append", default=[], metavar="LABEL=COUNT")
    rec.add_argument("--sample-note")
    rec.add_argument("--replace", action="store_true", help="replace an existing request")

    show = req_sub.add_parser("show", help="show the recorded request (pseudonymous)")
    show.add_argument("workspace", type=Path)

    ins = sub.add_parser("inspect", help="report a document's structure without its content")
    ins.add_argument("file", type=Path)

    orig = sub.add_parser("originals", help="import sampled original files")
    orig_sub = orig.add_subparsers(dest="action", required=True)
    oimp = orig_sub.add_parser(
        "import",
        help="import sampled originals from bulk zips and/or single files",
    )
    oimp.add_argument("workspace", type=Path)
    oimp.add_argument(
        "sources",
        type=Path,
        nargs="+",
        help="zips (e.g. main and late submission points) and/or single files",
    )
    oimp.add_argument("--replace", action="store_true")

    rub = sub.add_parser("rubric", help="import the rubric")
    rub_sub = rub.add_subparsers(dest="action", required=True)
    rimp = rub_sub.add_parser("import", help="import a rubric from CSV, JSON, XLSX, or DOCX")
    rimp.add_argument("workspace", type=Path)
    rimp.add_argument("file", type=Path)
    rimp.add_argument("--title")
    rimp.add_argument("--version", default="1")
    rimp.add_argument("--sheet", help="xlsx sheet name (default: first sheet)")
    rimp.add_argument(
        "--weight",
        action="append",
        default=[],
        metavar="CRITERION_ID=PERCENT",
        help="criterion weight, e.g. analytical-focus=25; repeatable",
    )
    rimp.add_argument(
        "--confirm",
        action="store_true",
        help="write a grid (xlsx/docx) import after checking the preview",
    )
    rimp.add_argument("--replace", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "workspace":
            ws = Workspace.create(
                args.name,
                root=args.root,
                retention_days=args.retention_days,
                retention_source=args.retention_source,
            )
            print(f"created workspace {ws.path}")
        elif args.command == "inspect":
            for line in inspect_path(args.file):
                print(line)
        elif args.command == "originals":
            result = import_originals(
                Workspace.open(args.workspace), args.sources, replace=args.replace
            )
            print(
                f"imported {len(result.imported)} sampled submission(s); "
                f"{result.ignored_count} other file(s) were not opened"
            )
            for sub in result.imported:
                print(
                    f"  {sub.id} {sub.pseudonym}: {len(sub.extract.blocks)} blocks, "
                    f"{len(sub.extract.text.split())} words"
                )
                for warning in sub.extract.warnings:
                    print(f"    warning: {warning}")
            for sub_id, reason in result.failed.items():
                print(f"  {sub_id}: FAILED: {reason}", file=sys.stderr)
            if result.failed:
                return 1
        elif args.command == "rubric":
            rubric, warnings, written = import_rubric(
                Workspace.open(args.workspace),
                args.file,
                title=args.title,
                version=args.version,
                weights=parse_weights(args.weight),
                sheet=args.sheet,
                confirm=args.confirm,
                replace=args.replace,
            )
            verb = "imported" if written else "preview of"
            print(
                f"{verb} rubric '{rubric.title}' (version {rubric.version}): "
                f"{len(rubric.criteria)} criteria"
            )
            for c in rubric.criteria:
                weight = f", weight {c.weight:g}%" if c.weight else ", no weight"
                labels = ", ".join(lvl.label for lvl in c.levels)
                print(f"  {c.id}: '{c.title}'{weight}; {len(c.levels)} levels: {labels}")
            for warning in warnings:
                print(f"  warning: {warning}")
            if not written:
                print("nothing written: check the preview, then re-run with --confirm")
        elif args.action == "record":
            ws = Workspace.open(args.workspace)
            request = record_request(
                ws,
                parse_sample(args.sample),
                cohort_size=args.cohort_size,
                multiple_groups=args.multiple_groups,
                programme=args.programme,
                module=args.module,
                staff_roles=args.staff_role,
                band_distribution=parse_bands(args.band),
                sample_note=args.sample_note,
                replace=args.replace,
            )
            print(f"recorded {len(request.sample)} sampled submissions:")
            for s in request.sample:
                band = f" (listed under {s.listed_band})" if s.listed_band else ""
                print(f"  {s.submission_id} {s.pseudonym}{band}")
        else:
            request = load_request(Workspace.open(args.workspace))
            print(json.dumps(request.model_dump(mode="json"), indent=2))
    except (
        RequestError,
        WorkspaceError,
        ImportProblem,
        RubricError,
        ExtractionError,
        InspectionError,
    ) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
