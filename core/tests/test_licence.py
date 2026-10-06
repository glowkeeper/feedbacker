"""The core's distributions carry Feedbacker's licence: the same text as the repository's."""

from pathlib import Path

CORE = Path(__file__).resolve().parents[1]
REPOSITORY = CORE.parent


def test_the_core_carries_the_repository_licence_unchanged():
    assert (CORE / "LICENSE").read_bytes() == (REPOSITORY / "LICENSE").read_bytes()


def test_the_core_notice_names_the_copyright_and_the_licence():
    notice = (CORE / "NOTICE").read_text(encoding="utf-8")
    copyright_line = next(
        line
        for line in (REPOSITORY / "NOTICE").read_text(encoding="utf-8").splitlines()
        if line.startswith("Copyright")
    )
    assert copyright_line in notice
    assert "Apache License, Version 2.0" in notice
