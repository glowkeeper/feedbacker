"""Select sampled submissions from bulk downloads without opening the rest (#15, #17).

A sample can be spread across several sources: a main bulk zip, a zip from a
second submission point (e.g. late submissions), split zip parts, or single
downloaded files. Each sampled identifier is matched across all of them.

A file matches an identifier when the identifier appears in its file name as a
whole token, i.e. not as part of a longer run of letters or digits. Only file
names are read to decide; unmatched files are never opened.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from feedbacker_core.structure import name_shape

SUPPORTED = {".docx", ".pdf"}


@dataclass(frozen=True)
class Member:
    source: Path  # the zip, or the single file itself
    name: str  # the member name inside the zip, or the file name

    @property
    def is_archive(self) -> bool:
        return self.source.suffix.lower() == ".zip"

    @property
    def file_name(self) -> str:
        return PurePosixPath(self.name).name

    @property
    def suffix(self) -> str:
        return Path(self.name).suffix.lower()

    def read(self) -> bytes:
        if not self.is_archive:
            return self.source.read_bytes()
        with zipfile.ZipFile(self.source) as z:
            return z.read(self.name)


@dataclass
class Selection:
    matched: dict[str, Member] = field(default_factory=dict)  # external_id -> member
    unmatched_ids: list[str] = field(default_factory=list)
    ambiguous: dict[str, list[Member]] = field(default_factory=dict)
    ignored_count: int = 0  # files not selected; never opened

    def problems(self, label=lambda external_id: external_id, sources=()) -> list[str]:
        """Describe problems without real file names, which may identify students.

        ``label`` names a sampled submission (e.g. by pseudonym); candidates are
        described by source position and name shape only.
        """
        index = {src: n for n, src in enumerate(sources, 1)}
        out = [f"no file found for {label(i)}" for i in self.unmatched_ids]
        for i, ms in self.ambiguous.items():
            where = ", ".join(
                f"source {index.get(m.source, '?')} ({name_shape(m.file_name)})" for m in ms
            )
            out.append(f"{label(i)} matches {len(ms)} files: {where}; resolve before importing")
        return out


def _token_pattern(external_id: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![A-Za-z0-9]){re.escape(external_id)}(?![A-Za-z0-9])")


def list_members(source: Path) -> list[Member]:
    if source.suffix.lower() != ".zip":
        if not source.is_file():
            raise ValueError(f"source not found: {name_shape(source.name)}")
        return [Member(source=source, name=source.name)]
    try:
        with zipfile.ZipFile(source) as z:
            return [
                Member(source=source, name=i.filename)
                for i in z.infolist()
                if not i.is_dir()
                and not PurePosixPath(i.filename).name.startswith(".")
                and "__MACOSX" not in i.filename
            ]
    except (zipfile.BadZipFile, FileNotFoundError) as err:
        raise ValueError(
            f"not a readable zip archive ({name_shape(source.name)}): {type(err).__name__}"
        ) from None


def select_members(sources: Path | list[Path], external_ids: list[str]) -> Selection:
    if isinstance(sources, Path):
        sources = [sources]
    members = [m for s in sources for m in list_members(s)]
    selection = Selection()
    used: set[Member] = set()
    for external_id in external_ids:
        pattern = _token_pattern(external_id)
        hits = [m for m in members if pattern.search(m.file_name)]
        if not hits:
            selection.unmatched_ids.append(external_id)
        elif len(hits) > 1:
            selection.ambiguous[external_id] = hits
        else:
            selection.matched[external_id] = hits[0]
            used.add(hits[0])
    selection.ignored_count = len([m for m in members if m not in used])
    return selection
