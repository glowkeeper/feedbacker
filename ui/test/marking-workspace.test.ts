/** A marking workspace: its type, its own steps, and the assessment it marks. */

import { expect, test } from "vitest";
import { loadOverview } from "../src/app/overview.ts";
import { MARKING, markingStates, MODERATION, navigationFor, statusWord, stepList } from "../src/app/steps.ts";
import { ASSESSMENT, bytesSource, importBrief, loadAssessment, recordAssessment, WorkspaceError } from "../src/core/index.ts";
import { packFile } from "./builders.ts";
import { newWorkspace } from "./proxyHarness.ts";

test("a workspace is a moderation unless it is made as a marking one, and its navigation follows its type", async () => {
  const moderation = (await newWorkspace("mod-1")).ws;
  const marking = (await newWorkspace("mark-1", { workspace_type: "marking" })).ws;
  expect([moderation.manifest.workspace_type, marking.manifest.workspace_type]).toEqual(["moderation", "marking"]);
  expect(navigationFor(moderation)).toBe(MODERATION);
  expect(navigationFor(marking)).toBe(MARKING);
  // Only the steps that work so far: nothing leads nowhere.
  expect(stepList(MARKING.entries).map((s) => s.label)).toEqual(["Overview", "Details", "Rubric", "Brief"]);
});

test("the assessment's details are recorded, read back, and changed by recording them again", async () => {
  const { ws } = await newWorkspace("mark-2", { workspace_type: "marking" });
  expect(await loadAssessment(ws)).toBeNull();
  const first = await recordAssessment(ws, { title: "  Coursework 1  ", module: "Fictional 101", programme: "  " });
  expect([first.title, first.module, first.programme, first.provenance.actor.kind]).toEqual(["Coursework 1", "Fictional 101", null, "educator"]);
  expect(await loadAssessment(ws)).toEqual(first);
  const second = await recordAssessment(ws, { title: "Coursework 2" });
  expect((await loadAssessment(ws))!.title).toBe(second.title);
});

test("an assessment needs its title, and a damaged record is reported, not used", async () => {
  const { ws } = await newWorkspace("mark-3", { workspace_type: "marking" });
  await expect(recordAssessment(ws, { title: "   " })).rejects.toThrow(WorkspaceError);
  await ws.writeJson(ASSESSMENT, { kind: "assessment", title: "" });
  await expect(loadAssessment(ws)).rejects.toThrow("is not a valid record of the assessment");
});

test("the marking steps' status lines say why, in the navigation's words", async () => {
  const { ws } = await newWorkspace("mark-4", { workspace_type: "marking" });
  let states = markingStates(await loadOverview(ws), null, null);
  expect(`${statusWord(states.get("assessment"))}: ${states.get("assessment")!.reason}`).toBe("Not started: no assessment recorded yet");
  expect(statusWord(states.get("rubric"))).toBe("Not started");
  const a = await recordAssessment(ws, { title: "Coursework 1" });
  states = markingStates(await loadOverview(ws), a, null);
  expect(`${statusWord(states.get("assessment"))}: ${states.get("assessment")!.reason}`).toBe("Done: Coursework 1");
  states = markingStates(await loadOverview(ws), null, "assessment.json is not a valid record of the assessment");
  expect(statusWord(states.get("assessment"))).toBe("Needs attention");
  expect(await MARKING.states(ws)).toBeInstanceOf(Map);
});

test("a marking workspace's brief is done once imported: it isn't sent to a step that isn't there yet", async () => {
  const { ws } = await newWorkspace("mark-5", { workspace_type: "marking" });
  const brief = async () => {
    const state = markingStates(await loadOverview(ws), null, null).get("brief")!;
    return `${statusWord(state)}: ${state.reason}`;
  };
  expect(await brief()).toBe("Not started: no brief imported; it is optional, but the AI's suggestions use it");
  await importBrief(ws, bytesSource("brief.docx", packFile("brief.docx")));
  expect(await brief()).toBe("Done: imported");
});
