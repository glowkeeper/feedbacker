"""A submission's figures, kept in the workspace's private area beside its record.

One file a figure, ``private/figures/<submission>/FIGURE_<n>.<ext>``, as its
extract lists it (placeholder, media type, hash, size). A figure is a
student's work and may show something identifying, so it is never anywhere
but the private area. This reference keeps a docx's figures; a PDF's have no
bytes here (the app keeps them as PNG).
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from feedbacker_core.models import Extract, Figure
from feedbacker_core.workspace import PRIVATE, Workspace

FIGURES = f"{PRIVATE}/figures"

_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/x-emf": "emf",
    "image/x-wmf": "wmf",
}


def _extension_of(media_type: str) -> str:
    return _EXTENSIONS.get(media_type) or media_type.removeprefix("image/").removeprefix("x-")


def figure_problems(workspace: Workspace, submission_id: str, figures: list[Figure]) -> list[str]:
    """What is wrong with these figures' stored images: one problem a missing or changed file."""
    out = []
    for figure in figures:
        relative = figure_path(submission_id, figure)
        if relative is None:
            continue  # its image wasn't extracted: nothing to check
        target = workspace.path / relative
        if not target.is_file():
            out.append(
                f"{submission_id} {figure.placeholder}: {relative} is missing; import it again"
            )
        elif hashlib.sha256(target.read_bytes()).hexdigest() != figure.sha256:
            out.append(
                f"{submission_id} {figure.placeholder}: {relative} isn't the image that was "
                "extracted; import it again"
            )
    return out


def figure_path(submission_id: str, figure: Figure) -> str | None:
    """Where a figure's bytes are kept; None for a figure without bytes."""
    if figure.media_type is None:
        return None
    name = figure.placeholder[1:-1]
    return f"{FIGURES}/{submission_id}/{name}.{_extension_of(figure.media_type)}"


@contextmanager
def replacing_figures(
    workspace: Workspace,
    submission_id: str,
    extract: Extract | None,
    figures: dict[str, bytes],
) -> Iterator[None]:
    """Put a submission's figures in place of any it had before, for the block's duration.

    The new set is written to a staging folder and swapped in whole. If the
    block (writing the submission's record) fails, or the swap does, the
    previous set is put back; once it succeeds, the previous set is removed.
    """
    root = workspace.path / FIGURES
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    folder = root / submission_id
    staging = Path(tempfile.mkdtemp(dir=root, prefix=f".new-{submission_id}-"))
    aside = root / f".old-{submission_id}-{staging.name.rsplit('-', 1)[-1]}"
    try:
        for figure in extract.figures if extract else []:
            relative = figure_path(submission_id, figure)
            data = figures.get(figure.placeholder)
            if relative is None or data is None:
                continue
            target = staging / Path(relative).name
            target.write_bytes(data)
            os.chmod(target, 0o600)
        if folder.exists():
            os.replace(folder, aside)
        try:
            os.replace(staging, folder)
            yield
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            if aside.exists():
                os.replace(aside, folder)
            raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(aside, ignore_errors=True)
