"""Local moderation workspace (ADR 0001, docs/data-handling.md).

A workspace is a folder on the moderator's machine, outside any git working
tree, holding everything for one moderation:

    <workspace>/
        workspace.json          layout version, retention period
        request.json            the moderation request (pseudonymous)
        private/
            pseudonym-key.json  pseudonyms -> real identifiers; never leaves the core

The pseudonym key is kept apart from everything else and readable only by the
moderator's user account.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, PositiveInt, ValidationError

LAYOUT_VERSION = 1
DEFAULT_ROOT = Path.home() / "Feedbacker" / "workspaces"
DEFAULT_RETENTION_DAYS = 90

MANIFEST = "workspace.json"
REQUEST = "request.json"
PRIVATE = "private"
KEY = "pseudonym-key.json"


class WorkspaceError(Exception):
    """A workspace cannot be created, opened, or written safely."""


class WorkspaceManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layout_version: int = LAYOUT_VERSION
    name: str
    created_at: AwareDatetime
    retention_days: PositiveInt = Field(
        default=DEFAULT_RETENTION_DAYS,
        description="Days after report submission before the workspace is deleted.",
    )
    retention_source: str = Field(
        default="default",
        description="Where the retention period came from, e.g. the commissioning body's terms.",
    )


class KeyEntry(BaseModel):
    """Links a pseudonym to real identifiers. Never exported to the UI or a model."""

    model_config = ConfigDict(extra="forbid")

    submission_id: str
    pseudonym: str
    external_id: str
    names: list[str] = Field(default_factory=list)
    source_files: dict[str, str] = Field(
        default_factory=dict,
        description="Original file names by role (e.g. 'original'); names may identify the student.",
    )


class TokenEntry(BaseModel):
    """A pseudonym for a redacted value that is not a sampled student (e.g. [ORG_1])."""

    model_config = ConfigDict(extra="forbid")

    token: str
    kind: str
    value: str


class PseudonymKey(BaseModel):
    """Append-only: once assigned, a pseudonym always refers to the same identifier.

    Entries are never removed or reassigned, even when a submission leaves the
    sample, so records keyed by a pseudonym can never point at another student.
    """

    model_config = ConfigDict(extra="forbid")

    entries: list[KeyEntry] = Field(default_factory=list)
    tokens: list[TokenEntry] = Field(default_factory=list)

    def token_for(self, kind: str, value: str) -> str:
        """The stable token for a value; allocates the next one if new (append-only)."""
        folded = value.casefold()
        for t in self.tokens:
            if t.kind == kind and t.value.casefold() == folded:
                return t.token
        n = 1 + sum(1 for t in self.tokens if t.kind == kind)
        token = f"[{kind}_{n}]"
        self.tokens.append(TokenEntry(token=token, kind=kind, value=value))
        return token

    def with_entries(self, entries: list[KeyEntry]) -> PseudonymKey:
        """A copy with new entries and every existing token kept. Always rebuild the
        key this way so token mappings are never lost."""
        return PseudonymKey(entries=entries, tokens=list(self.tokens))

    def by_external_id(self, external_id: str) -> KeyEntry | None:
        return next((e for e in self.entries if e.external_id == external_id), None)

    def by_pseudonym(self, pseudonym: str) -> KeyEntry | None:
        return next((e for e in self.entries if e.pseudonym == pseudonym), None)


def git_working_tree(path: Path) -> Path | None:
    """Return the enclosing git working tree root, if any."""
    for candidate in [path, *path.parents]:
        if (candidate / ".git").exists():
            return candidate
    return None


class Workspace:
    def __init__(self, path: Path, manifest: WorkspaceManifest):
        self.path = path
        self.manifest = manifest

    # --- lifecycle ---------------------------------------------------------

    @classmethod
    def create(
        cls,
        name: str,
        root: Path | None = None,
        retention_days: int = DEFAULT_RETENTION_DAYS,
        retention_source: str = "default",
    ) -> Workspace:
        if not name or "/" in name or name.startswith("."):
            raise WorkspaceError(f"invalid workspace name '{name}'")
        path = (root or DEFAULT_ROOT).expanduser().resolve() / name
        _refuse_git(path)
        if path.exists():
            raise WorkspaceError(f"workspace already exists: {path}")
        # Validate everything before touching the disk, so a bad input never
        # leaves a partial workspace behind.
        try:
            manifest = WorkspaceManifest(
                name=name,
                created_at=datetime.now(UTC),
                retention_days=retention_days,
                retention_source=retention_source,
            )
        except ValidationError as err:
            problems = "; ".join(
                f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in err.errors()
            )
            raise WorkspaceError(f"invalid workspace settings: {problems}") from None
        path.mkdir(parents=True, mode=0o700)
        (path / PRIVATE).mkdir(mode=0o700)
        ws = cls(path, manifest)
        ws.write_json(MANIFEST, manifest.model_dump(mode="json"))
        return ws

    @classmethod
    def open(cls, path: Path) -> Workspace:
        path = path.expanduser().resolve()
        _refuse_git(path)
        manifest_path = path / MANIFEST
        if not manifest_path.is_file():
            raise WorkspaceError(f"not a Feedbacker workspace: {path}")
        manifest = WorkspaceManifest.model_validate_json(manifest_path.read_text())
        if manifest.layout_version != LAYOUT_VERSION:
            raise WorkspaceError(
                f"workspace layout version {manifest.layout_version} is not supported "
                f"(expected {LAYOUT_VERSION})"
            )
        return cls(path, manifest)

    # --- files -------------------------------------------------------------

    def exists(self, relative: str) -> bool:
        return (self.path / relative).exists()

    def read_json(self, relative: str) -> object:
        return json.loads((self.path / relative).read_text())

    def write_json(self, relative: str, data: object, private: bool = False) -> Path:
        """Write atomically; private files are readable only by the owner."""
        target = self.path / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh, indent=2, ensure_ascii=False)
                fh.write("\n")
            os.chmod(tmp, 0o600 if private else 0o644)
            os.replace(tmp, target)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return target

    # --- pseudonym key -----------------------------------------------------

    @property
    def key_path(self) -> Path:
        return self.path / PRIVATE / KEY

    def read_key(self) -> PseudonymKey:
        if not self.key_path.exists():
            return PseudonymKey()
        return PseudonymKey.model_validate_json(self.key_path.read_text())

    def write_key(self, key: PseudonymKey) -> None:
        self.write_json(f"{PRIVATE}/{KEY}", key.model_dump(mode="json"), private=True)


def _refuse_git(path: Path) -> None:
    tree = git_working_tree(path)
    if tree is not None:
        raise WorkspaceError(
            f"refusing to use a workspace inside a git working tree ({tree}); "
            "real assessment material must stay outside any repository"
        )
