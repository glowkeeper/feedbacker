"""A submission's figures, kept in the workspace's private area beside its record.

One file a figure, ``private/figures/<submission>/FIGURE_<n>.<ext>``, as its
extract lists it (placeholder, media type, hash, size). A figure is a
student's work and may show something identifying, so it is never anywhere
but the private area. This reference keeps a docx's figures; a PDF's have no
bytes here (the app keeps them as PNG).
"""

from __future__ import annotations

import os
import shutil

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


def figure_path(submission_id: str, figure: Figure) -> str | None:
    """Where a figure's bytes are kept; None for a figure without bytes."""
    if figure.media_type is None:
        return None
    name = figure.placeholder[1:-1]
    return f"{FIGURES}/{submission_id}/{name}.{_extension_of(figure.media_type)}"


def write_figures(
    workspace: Workspace, submission_id: str, extract: Extract, figures: dict[str, bytes]
) -> None:
    """Keep a submission's figures, private, replacing any it had before."""
    folder = workspace.path / FIGURES / submission_id
    shutil.rmtree(folder, ignore_errors=True)
    for figure in extract.figures:
        relative = figure_path(submission_id, figure)
        data = figures.get(figure.placeholder)
        if relative is None or data is None:
            continue
        target = workspace.path / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        target.write_bytes(data)
        os.chmod(target, 0o600)
