"""Workspaces stay outside git and keep the pseudonym key private."""

from __future__ import annotations

import stat

import pytest

from feedbacker_core.workspace import KeyEntry, PseudonymKey, Workspace, WorkspaceError


def test_create_and_open(tmp_path):
    ws = Workspace.create("mod-1", root=tmp_path, retention_days=60, retention_source="terms")
    reopened = Workspace.open(ws.path)
    assert reopened.manifest.retention_days == 60
    assert reopened.manifest.retention_source == "terms"


def test_default_retention_is_90_days(tmp_path):
    assert Workspace.create("mod-1", root=tmp_path).manifest.retention_days == 90


def test_refuses_inside_git_working_tree(tmp_path):
    (tmp_path / "repo" / ".git").mkdir(parents=True)
    with pytest.raises(WorkspaceError, match="inside a git working tree"):
        Workspace.create("mod-1", root=tmp_path / "repo" / "deep")


def test_refuses_to_open_inside_git_working_tree(tmp_path):
    ws = Workspace.create("mod-1", root=tmp_path)
    (tmp_path / ".git").mkdir()
    with pytest.raises(WorkspaceError, match="inside a git working tree"):
        Workspace.open(ws.path)


def test_refuses_existing_and_invalid_names(tmp_path):
    Workspace.create("mod-1", root=tmp_path)
    with pytest.raises(WorkspaceError, match="already exists"):
        Workspace.create("mod-1", root=tmp_path)
    for bad in ["", "../escape", ".hidden"]:
        with pytest.raises(WorkspaceError, match="invalid workspace name"):
            Workspace.create(bad, root=tmp_path)


def test_open_rejects_non_workspace(tmp_path):
    with pytest.raises(WorkspaceError, match="not a Feedbacker workspace"):
        Workspace.open(tmp_path)


def test_key_is_private_to_the_owner(tmp_path):
    ws = Workspace.create("mod-1", root=tmp_path)
    ws.write_key(
        PseudonymKey(
            entries=[
                KeyEntry(submission_id="sub-001", pseudonym="[STUDENT_A]", external_id="100200300")
            ]
        )
    )
    assert stat.S_IMODE(ws.key_path.stat().st_mode) == 0o600
    assert stat.S_IMODE((ws.path / "private").stat().st_mode) == 0o700
    assert ws.read_key().entries[0].external_id == "100200300"
