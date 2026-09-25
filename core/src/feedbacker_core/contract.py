"""Export the data contract as JSON Schema (ADR 0002).

Usage (from ``core/``):

    uv run python -m feedbacker_core.contract          # write the schema
    uv run python -m feedbacker_core.contract --check  # fail if it is stale
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic.json_schema import models_json_schema

from feedbacker_core.models import CONTRACT_TYPES, SCHEMA_VERSION

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "contract" / "feedbacker.schema.json"


def build_schema() -> dict:
    _, schema = models_json_schema(
        [(model, "serialization") for model in CONTRACT_TYPES],
        title="Feedbacker contract",
    )
    # Property-level titles make type generators emit one alias per field
    # (Id1, Id2, ...). Type names come from $defs, so drop them.
    for definition in schema["$defs"].values():
        for prop in definition.get("properties", {}).values():
            prop.pop("title", None)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = f"https://feedbacker.education/contract/{SCHEMA_VERSION}"
    schema["description"] = (
        "Generated from core/src/feedbacker_core/models.py. Do not edit by hand."
    )
    # A root that references every top-level contract type, so type generators
    # emit all of them.
    schema["oneOf"] = [{"$ref": f"#/$defs/{m.__name__}"} for m in CONTRACT_TYPES]
    return schema


def render() -> str:
    return json.dumps(build_schema(), indent=2, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the schema is stale")
    args = parser.parse_args(argv)

    rendered = render()
    if args.check:
        current = SCHEMA_PATH.read_text() if SCHEMA_PATH.exists() else ""
        if current != rendered:
            print(
                f"{SCHEMA_PATH} is out of date; run `uv run python -m feedbacker_core.contract`",
                file=sys.stderr,
            )
            return 1
        print("contract schema is up to date")
        return 0

    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(rendered)
    print(f"wrote {SCHEMA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
