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
    feedbacker anonymise run WORKSPACE [--name N] [--org O] [--redact V[=KIND]] [--ignore V]
    feedbacker anonymise show WORKSPACE SUBMISSION_ID [--with-values]
    feedbacker anonymise approve WORKSPACE SUBMISSION_ID [SUBMISSION_ID ...]
    feedbacker marking import WORKSPACE SOURCE [SOURCE ...] [--criterion NAME=ID ...] [--replace]
    feedbacker marking show WORKSPACE SUBMISSION_ID [--marker LABEL]
    feedbacker marking confirm WORKSPACE SUBMISSION_ID [SUBMISSION_ID ...]
    feedbacker marking enter WORKSPACE SUBMISSION_ID [--overall N] [--criterion ID=POINTS ...]
        [--comment TEXT] [--marker LABEL]

``request show`` prints the pseudonymous request only, and ``inspect`` prints
structure only. Neither ever prints external identifiers, names, or document
text.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from feedbacker_core.anonymise import anonymise_workspace, approve, review_lines, update_rules
from feedbacker_core.extract import ExtractionError
from feedbacker_core.marking import (
    MarkingProblem,
    confirm_marking,
    enter_marking,
    import_marking,
    marking_summary,
)
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
    an = sub.add_parser("anonymise", help="redact, review, and approve submissions")
    an_sub = an.add_subparsers(dest="action", required=True)
    run = an_sub.add_parser("run", help="redact all imported submissions")
    run.add_argument("workspace", type=Path)
    run.add_argument("--name", action="append", default=[], help="another person's name")
    run.add_argument("--org", action="append", default=[], help="an organisation to redact")
    run.add_argument(
        "--redact",
        action="append",
        default=[],
        metavar="VALUE[=KIND]",
        help="any other value to redact, optionally with a token kind (e.g. =USERNAME)",
    )
    run.add_argument("--ignore", action="append", default=[], help="a false positive to keep")
    shw = an_sub.add_parser("show", help="show a submission's anonymised text")
    shw.add_argument("workspace", type=Path)
    shw.add_argument("submission_id")
    shw.add_argument(
        "--with-values",
        action="store_true",
        help="also list each redaction's REAL value, for local review only",
    )
    mk = sub.add_parser("marking", help="the original marker's marks and comments")
    mk_sub = mk.add_subparsers(dest="action", required=True)
    mimp = mk_sub.add_parser("import", help="import marked views (zips and/or single files)")
    mimp.add_argument("workspace", type=Path)
    mimp.add_argument("sources", type=Path, nargs="+")
    mimp.add_argument(
        "--criterion",
        action="append",
        default=[],
        metavar="MARKER_NAME=SOURCE_ID",
        help="map a marker's criterion name to a source rubric criterion; repeatable",
    )
    mimp.add_argument("--replace", action="store_true")
    mshow = mk_sub.add_parser("show", help="summarise a submission's marking")
    mshow.add_argument("workspace", type=Path)
    mshow.add_argument("submission_id")
    mshow.add_argument("--marker", default="marker")
    mconf = mk_sub.add_parser("confirm", help="confirm imported marking after checking it")
    mconf.add_argument("workspace", type=Path)
    mconf.add_argument("submission_ids", nargs="+")
    ment = mk_sub.add_parser("enter", help="enter or correct marking by hand")
    ment.add_argument("workspace", type=Path)
    ment.add_argument("submission_id")
    ment.add_argument("--overall", type=float)
    ment.add_argument("--criterion", action="append", default=[], metavar="SOURCE_ID=POINTS")
    ment.add_argument("--comment")
    ment.add_argument("--marker", default="marker")

    apr = an_sub.add_parser("approve", help="approve submissions' anonymised text")
    apr.add_argument("workspace", type=Path)
    apr.add_argument("submission_ids", nargs="+")
    return parser


def parse_pairs(values: list[str], form: str) -> dict[str, str]:
    pairs: dict[str, str] = {}
    for value in values:
        k, sep, v = value.rpartition("=")
        if not sep or not k.strip() or not v.strip():
            raise MarkingProblem([f"'{value}' must look like {form}"])
        pairs[k.strip()] = v.strip()
    return pairs


def parse_redactions(values: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for value in values:
        text, sep, kind = value.rpartition("=")
        if sep and kind.isupper() and kind.isalpha():
            out[text] = kind
        else:
            out[value] = "REDACTED"
    return out


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
        elif args.command == "marking":
            ws = Workspace.open(args.workspace)
            if args.action == "import":
                mapping = parse_pairs(args.criterion, "MARKER_NAME=SOURCE_ID")
                result = import_marking(ws, args.sources, criteria=mapping, replace=args.replace)
                print(
                    f"imported marking for {len(result.imported)} sampled submission(s); "
                    f"{result.ignored_count} other file(s) were not opened"
                )
                for warning in result.download_warnings:
                    print(f"  warning: {warning}")
                for a in result.imported:
                    print(
                        f"  {a.submission_id}: {len(a.criterion_marks)} criteria, "
                        f"{len(a.annotations)} comments, {len(a.import_notes)} note(s)"
                    )
                for sub_id, reason in result.failed.items():
                    print(f"  {sub_id}: FAILED: {reason}", file=sys.stderr)
                if result.unmapped:
                    print("  unmapped marker criteria: " + ", ".join(sorted(result.unmapped)))
                    print("  source rubric criterion IDs: " + ", ".join(result.source_ids))
                    print('  map them with --criterion "MARKER NAME=source-id" and --replace')
                print("check each with 'marking show', then 'marking confirm'")
                if result.failed:
                    return 1
            elif args.action == "show":
                for line in marking_summary(ws, args.submission_id, args.marker):
                    print(line)
            elif args.action == "confirm":
                for sub_id in args.submission_ids:
                    a = confirm_marking(ws, sub_id)
                    print(f"confirmed marking for {sub_id} at {a.confirmed_at.isoformat()}")
            else:
                points = {
                    k: float(v) for k, v in parse_pairs(args.criterion, "SOURCE_ID=POINTS").items()
                }
                a = enter_marking(
                    ws,
                    args.submission_id,
                    marker_label=args.marker,
                    overall=args.overall,
                    criteria=points,
                    comment=args.comment,
                )
                print(f"recorded marking for {args.submission_id} ({a.marker_label}) by hand")
        elif args.command == "anonymise":
            ws = Workspace.open(args.workspace)
            if args.action == "run":
                update_rules(
                    ws,
                    names=args.name,
                    organisations=args.org,
                    redact=parse_redactions(args.redact),
                    ignore=args.ignore,
                )
                result = anonymise_workspace(ws)
                for sub_id, counts in result.counts.items():
                    summary = ", ".join(f"{n} {k}" for k, n in sorted(counts.items())) or "none"
                    status = (
                        "approval kept (text unchanged)"
                        if result.approval_kept[sub_id]
                        else ("needs approval")
                    )
                    print(f"  {sub_id}: redactions: {summary}; {status}")
                print("review each with 'anonymise show', then 'anonymise approve'")
            elif args.action == "show":
                for line in review_lines(ws, args.submission_id, args.with_values):
                    print(line)
            else:
                for sub_id in args.submission_ids:
                    appr = approve(ws, sub_id)
                    print(f"approved {sub_id} ({appr.id}) at {appr.approved_at.isoformat()}")
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
        MarkingProblem,
    ) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
