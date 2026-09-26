"""Keep the Python reference models compatible with the contract (ADR 0004).

The TypeScript zod models in ``ui/src/core/models.ts`` own the data contract
and generate ``contract/feedbacker.schema.json``. While the Python core is
the reference implementation, both must agree on ``contract/conformance.json``:
the same cases valid, and the same canonical output for each valid case. This
module checks the Python side and records its canonical outputs in
``contract/conformance.expected.json``, which the TypeScript tests compare
against.

Usage (from ``core/``):

    uv run python -m feedbacker_core.contract          # check cases, write expected outputs
    uv run python -m feedbacker_core.contract --check  # fail if anything disagrees or is stale
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from feedbacker_core import models, workspace

ROOT = Path(__file__).resolve().parents[3]
CASES_PATH = ROOT / "contract" / "conformance.json"
EXPECTED_PATH = ROOT / "contract" / "conformance.expected.json"


def _resolve(data: Any, path: list[str | int]) -> tuple[Any, str | int]:
    """The container holding the last step of ``path``, and that step."""
    for step in path[:-1]:
        data = data[step]
    return data, path[-1]


def build_case(case: dict) -> Any:
    """The case's input: a fixture or inline data, narrowed by 'select', then patched."""
    data = json.loads((ROOT / case["fixture"]).read_text()) if "fixture" in case else case["data"]
    data = copy.deepcopy(data)
    for step in case.get("select", []):
        data = data[step]
    for op in case.get("patch", []):
        container, key = _resolve(data, op["path"])
        if op["op"] == "set":
            container[key] = copy.deepcopy(op["value"])
        elif op["op"] == "remove":
            del container[key]
        elif op["op"] == "duplicate":
            container[key].append(copy.deepcopy(container[key][op["index"]]))
        else:
            raise ValueError(f"unknown patch op {op['op']!r}")
    return data


def evaluate() -> tuple[dict[str, Any], list[str]]:
    """Canonical output for each valid case, and any case Python disagrees with."""
    cases = json.loads(CASES_PATH.read_text())["cases"]
    expected: dict[str, Any] = {}
    problems: list[str] = []
    for case in cases:
        # Contract records, plus the workspace's own files (manifest, pseudonym key).
        model = getattr(models, case["type"], None) or getattr(workspace, case["type"])
        try:
            record = model.model_validate(build_case(case))
            outcome, detail = True, ""
        except ValidationError as err:
            record, outcome, detail = None, False, str(err).splitlines()[0]
        if outcome != case["valid"]:
            state = "accepts" if outcome else f"rejects ({detail})"
            problems.append(
                f"{case['name']}: Python {state}, but the case says valid={case['valid']}"
            )
        if record is not None and case["valid"]:
            expected[case["name"]] = record.model_dump(mode="json")
    return expected, problems


def render(expected: dict[str, Any]) -> str:
    return json.dumps(expected, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="fail if anything disagrees or is stale"
    )
    args = parser.parse_args(argv)

    expected, problems = evaluate()
    if problems:
        print("conformance cases disagree with the Python models:", file=sys.stderr)
        for p in problems:
            print(f"- {p}", file=sys.stderr)
        return 1
    rendered = render(expected)
    if args.check:
        current = EXPECTED_PATH.read_text() if EXPECTED_PATH.exists() else ""
        if current != rendered:
            print(
                f"{EXPECTED_PATH} is out of date; run `uv run python -m feedbacker_core.contract`",
                file=sys.stderr,
            )
            return 1
        print("conformance cases agree and expected outputs are up to date")
        return 0
    EXPECTED_PATH.write_text(rendered)
    print(f"wrote {EXPECTED_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
