"""Command-line entry for Stage 0 tasks that precede the UI.

    feedbacker workspace create NAME [--root DIR] [--retention-days N] [--retention-source TEXT]
    feedbacker request record WORKSPACE --sample BAND:ID[,ID...] ... [options]
    feedbacker request show WORKSPACE

``request show`` prints the pseudonymous request only. It never prints
external identifiers.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from feedbacker_core.models import BandCount
from feedbacker_core.request import RequestError, SampleEntry, load_request, record_request
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
        elif args.action == "record":
            ws = Workspace.open(args.workspace)
            request = record_request(
                ws,
                parse_sample(args.sample),
                cohort_size=args.cohort_size,
                multiple_groups=args.multiple_groups,
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
    except (RequestError, WorkspaceError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
