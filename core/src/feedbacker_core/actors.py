"""Who records what in a workspace: the moderator, or the educator marking."""

from __future__ import annotations

from feedbacker_core.models import Actor, ActorKind
from feedbacker_core.workspace import Workspace

MODERATOR = Actor(kind=ActorKind.MODERATOR, label="moderator")
EDUCATOR = Actor(kind=ActorKind.EDUCATOR, label="educator")


def owner_of(workspace: Workspace) -> Actor:
    """Who works the workspace, and so imports, records and approves in it."""
    return EDUCATOR if workspace.manifest.workspace_type == "marking" else MODERATOR
