"""The AI reading, tested with a fake client: no test contacts the API or spends money."""

from __future__ import annotations

import json
import stat
from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from helpers import PACK, make_zip

from feedbacker_core import cli, reading
from feedbacker_core.anonymise import anonymise_workspace, approve, update_rules
from feedbacker_core.brief import import_brief
from feedbacker_core.marking import load_rubric
from feedbacker_core.originals import import_originals
from feedbacker_core.reading import (
    CriterionReadingOut,
    ReadingError,
    ReadingOut,
    load_api_key,
    load_readings,
    plan_readings,
    run_readings,
)
from feedbacker_core.request import SampleEntry, record_request
from feedbacker_core.rubric_import import import_rubric
from feedbacker_core.workspace import Workspace

SUBS = PACK / "submissions"


# --- A fake Anthropic client --------------------------------------------------------


class FakeResponse:
    def __init__(self, parsed, stop_reason="end_turn", model="claude-sonnet-5", usage=None):
        self.parsed_output = parsed
        self.stop_reason = stop_reason
        self.model = model
        self._request_id = f"req_{model}"
        self.usage = SimpleNamespace(
            **(
                usage
                or {
                    "input_tokens": 5000,
                    "output_tokens": 2000,
                    "cache_read_input_tokens": 0,
                    "cache_creation_input_tokens": 0,
                }
            )
        )

    def to_json(self):
        return json.dumps({"model": self.model, "stop_reason": self.stop_reason})


class FakeClient:
    """Records every request; returns scripted responses (or raises scripted errors)."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(parse=self._parse)

    def _parse(self, **kwargs):
        self.calls.append(kwargs)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item(kwargs) if callable(item) else item


def api_error(cls, status):
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("error", response=httpx2.Response(status, request=req), body=None)


# --- Workspace setup ----------------------------------------------------------------


@pytest.fixture
def ws(tmp_path):
    w = Workspace.create("mod-1", root=tmp_path / "workspaces")
    record_request(w, [SampleEntry("100200301"), SampleEntry("100200302")])
    import_originals(
        w,
        make_zip(
            tmp_path / "o.zip",
            {
                "100200301 - QUILL AVERY . - a.docx": (SUBS / "sub-a.docx").read_bytes(),
                "100200302 - PIKE JORDAN - b.pdf": (SUBS / "sub-b.pdf").read_bytes(),
            },
        ),
    )
    import_rubric(w, PACK / "rubric.csv", title="Synthetic")
    import_brief(w, PACK / "brief.docx")
    update_rules(w, names=["Morgan Ellis"])
    anonymise_workspace(w)
    for rid in ("sub-001", "sub-002", "brief"):
        approve(w, rid)
    return w


def good_reading(ws, quote_from=None, level="p68"):
    """A valid structured reading; quotes one real passage and one invented one."""

    def make(request):
        text = request["messages"][0]["content"][2]["text"]
        real = quote_from or text.split("\n\n", 2)[-1][:40]
        return FakeResponse(
            ReadingOut(
                criteria=[
                    CriterionReadingOut(
                        criterion_id=c.id,
                        suggested_level_id=level,
                        rationale="Fits the descriptor.",
                        evidence=[real, "a sentence that is not in the submission"],
                        draft_comment="Consider evaluating against your requirements.",
                        missing_evidence=False,
                    )
                    for c in load_rubric(ws).criteria
                ]
            )
        )

    return make


# --- Planning and estimates -----------------------------------------------------------


def test_plan_estimates_without_sending(ws):
    plan = plan_readings(ws)
    assert [r.submission_id for r in plan.readings] == ["sub-001", "sub-002"]
    assert plan.model == "claude-sonnet-5" and plan.fallback_model == "claude-opus-5"
    assert plan.brief_approval is not None and 0 < plan.estimated_cost < 5


def test_plan_skips_unapproved_and_requires_an_approved_brief(ws):
    update_rules(ws, redact={"MoSCoW": "REDACTED"})
    anonymise_workspace(ws)  # clears sub-001's approval; the brief is unchanged
    plan = plan_readings(ws)
    assert "sub-001" in plan.skipped and "not been approved" in plan.skipped["sub-001"]
    update_rules(ws, redact={"Office hours": "REDACTED"})
    anonymise_workspace(ws)  # now the brief's approval is cleared too
    with pytest.raises(ReadingError, match="approve it"):
        plan_readings(ws)


def test_unknown_model_and_bad_limit_are_refused(ws):
    with pytest.raises(ReadingError, match="no price is known"):
        plan_readings(ws, model="claude-imaginary-9")
    with pytest.raises(ReadingError, match="greater than 0"):
        plan_readings(ws, cap_usd=0)


# --- What is sent -----------------------------------------------------------------------


def test_only_approved_anonymised_text_is_sent_and_no_original_marks(ws):
    client = FakeClient(good_reading(ws), good_reading(ws))
    run_readings(ws, plan_readings(ws), client=client)
    assert len(client.calls) == 2
    for call in client.calls:
        sent = json.dumps(call, default=str)
        for real in (
            "Avery Quill",
            "Quill",
            "Jordan Pike",
            "S0000101",
            "avery.quill@example.com",
            "Morgan Ellis",
            "m.ellis@example.com",
            "100200301",
        ):
            assert real not in sent, real
        # The original marker's marks and comments are never part of a request.
        assert "Excellent, well-evidenced work throughout" not in sent
        assert "Good app, nice use of React" not in sent
        assert call["model"] == "claude-sonnet-5" and call["output_format"] is ReadingOut
        assert "temperature" not in call
    assert "[STUDENT_A]" in json.dumps(client.calls[0], default=str)
    assert "ASSESSMENT BRIEF" in client.calls[0]["messages"][0]["content"][1]["text"]


def test_gate_is_rechecked_immediately_before_sending(ws):
    plan = plan_readings(ws)
    update_rules(ws, redact={"MoSCoW": "REDACTED"})
    anonymise_workspace(ws)  # sub-001 changed after planning: its approval is gone
    client = FakeClient(good_reading(ws))
    result = run_readings(ws, plan, client=client)
    assert "sub-001" in result.failed and "not been approved" in result.failed["sub-001"]
    assert len(client.calls) == 1  # only sub-002 was sent


# --- Results ---------------------------------------------------------------------------


def test_suggestions_record_provenance_and_verify_quotes(ws):
    run_readings(ws, plan_readings(ws), client=FakeClient(good_reading(ws), good_reading(ws)))
    suggestions = load_readings(ws, "sub-001")
    assert len(suggestions) == 4
    s = suggestions[0]
    assert s.suggested_level_id == "p68" and s.provenance.actor.kind == "model"
    assert [e.verified for e in s.evidence] == [True, False]
    call = s.call
    assert call.prompt_version == "reading-v1" and call.model_reported == "claude-sonnet-5"
    assert call.approval_id.startswith("appr-sub-001-")
    assert call.brief_approval_id.startswith("appr-brief-") and call.brief_sha256
    assert call.usage.input_tokens == 5000 and call.fallback_from is None
    raw = list((ws.path / "readings" / "raw").iterdir())
    assert raw and stat.S_IMODE(raw[0].stat().st_mode) == 0o600
    runs = list((ws.path / "readings" / "runs").iterdir())
    log = json.loads(runs[0].read_text())
    assert log["spent_usd"] > 0 and len(log["calls"]) == 2


def test_invalid_levels_and_criteria_are_flagged_not_trusted(ws):
    def odd(request):
        rubric = load_rubric(ws)
        return FakeResponse(
            ReadingOut(
                criteria=[
                    CriterionReadingOut(
                        criterion_id=rubric.criteria[0].id,
                        suggested_level_id="p999",
                        rationale="?",
                        evidence=[],
                        draft_comment="",
                        missing_evidence=False,
                    ),
                    CriterionReadingOut(
                        criterion_id="invented",
                        suggested_level_id=None,
                        rationale="?",
                        evidence=[],
                        draft_comment="",
                        missing_evidence=True,
                    ),
                ]
            )
        )

    result = run_readings(ws, plan_readings(ws, ["sub-001"]), client=FakeClient(odd))
    warnings = "\n".join(result.warnings["sub-001"])
    assert "'p999' is not a level" in warnings
    assert "unknown criteria: invented" in warnings
    assert "no reading returned for criterion 'implementation'" in warnings
    (s,) = load_readings(ws, "sub-001")
    assert s.suggested_level_id is None and s.missing_evidence


def test_truncated_reading_fails(ws):
    client = FakeClient(FakeResponse(None, stop_reason="max_tokens"))
    result = run_readings(ws, plan_readings(ws, ["sub-001"]), client=client)
    assert "incomplete (stop reason: max_tokens)" in result.failed["sub-001"]


# --- Spend limit, fallback, and errors ---------------------------------------------------


def test_spend_limit_stops_the_run(ws):
    per_call = plan_readings(ws).readings[0].cost
    plan = plan_readings(ws, cap_usd=per_call * 1.5)  # room for one call, not two
    # The first call really costs about its worst-case estimate, so the second no longer fits.
    expensive = {
        "input_tokens": 20000,
        "output_tokens": 8000,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 0,
    }

    def costly(request):
        r = good_reading(ws)(request)
        r.usage = SimpleNamespace(**expensive)
        return r

    client = FakeClient(costly, costly)
    result = run_readings(ws, plan, client=client)
    assert list(result.read) == ["sub-001"]
    assert "spend limit would be exceeded" in result.not_run["sub-002"]
    assert len(client.calls) == 1


def test_refusal_falls_back_to_opus_and_is_recorded(ws):
    refused = FakeResponse(None, stop_reason="refusal")
    rescued = good_reading(ws)

    def as_opus(request):
        r = rescued(request)
        r.model = "claude-opus-5"
        return r

    client = FakeClient(refused, as_opus)
    result = run_readings(ws, plan_readings(ws, ["sub-001"]), client=client)
    assert result.fallbacks == ["sub-001"] and "sub-001" in result.read
    assert [c["model"] for c in client.calls] == ["claude-sonnet-5", "claude-opus-5"]
    call = load_readings(ws, "sub-001")[0].call
    assert call.fallback_from == "claude-sonnet-5" and call.model_requested == "claude-opus-5"


def test_refusal_without_fallback_is_recorded_as_declined(ws):
    client = FakeClient(FakeResponse(None, stop_reason="refusal"))
    result = run_readings(ws, plan_readings(ws, ["sub-001"], fallback=False), client=client)
    assert "declined" in result.failed["sub-001"] and len(client.calls) == 1


def test_rejected_key_stops_the_run_cleanly(ws):
    client = FakeClient(api_error(anthropic.AuthenticationError, 401))
    with pytest.raises(ReadingError, match="API key was rejected"):
        run_readings(ws, plan_readings(ws), client=client)
    assert list((ws.path / "readings" / "runs").iterdir())  # the run is still logged


def test_server_errors_fail_one_submission_only(ws):
    client = FakeClient(api_error(anthropic.InternalServerError, 500), good_reading(ws))
    result = run_readings(ws, plan_readings(ws), client=client)
    assert "HTTP 500" in result.failed["sub-001"] and "sub-002" in result.read


# --- Credentials -------------------------------------------------------------------------


def test_api_key_from_env_or_private_file(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("# comment\nANTHROPIC_API_KEY='sk-ant-test-123'\n")
    env.chmod(0o600)
    assert load_api_key(env) == "sk-ant-test-123"
    env.chmod(0o644)
    with pytest.raises(ReadingError, match="readable by other users") as err:
        load_api_key(env)
    assert "sk-ant" not in str(err.value)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env")
    assert load_api_key(env) == "sk-ant-env"
    monkeypatch.delenv("ANTHROPIC_API_KEY")
    with pytest.raises(ReadingError, match="no Anthropic API key"):
        load_api_key(tmp_path / "missing.env")


# --- Command line -------------------------------------------------------------------------


def test_cli_estimates_without_confirm_and_runs_with_it(ws, monkeypatch, capsys):
    fake = FakeClient(good_reading(ws), good_reading(ws))
    monkeypatch.setattr(reading, "make_client", lambda: fake)
    path = str(ws.path)
    assert cli.main(["reading", "run", path]) == 0
    out = capsys.readouterr().out
    assert "estimated at most $" in out and "nothing sent" in out and fake.calls == []
    assert cli.main(["reading", "run", path, "--confirm"]) == 0
    out = capsys.readouterr().out
    assert "sub-001: read" in out and "spent $" in out and len(fake.calls) == 2
    assert cli.main(["reading", "show", path, "sub-001"]) == 0
    shown = capsys.readouterr().out
    assert "These are suggestions, not marks." in shown and "1 UNVERIFIED" in shown
    assert cli.main(["reading", "run", path]) == 0
    assert "already read" in capsys.readouterr().out
