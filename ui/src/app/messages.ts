/**
 * A message shown in a Status region: its words and the kind of outcome they report, kept together so a kind can
 * never be left over from an earlier message. Done is an action that succeeded; info is neutral (progress, or nothing
 * done); error is a failure. Notes to check and problems listed together are Problems' kinds.
 */
export type MessageKind = "done" | "info" | "error";

export interface Message {
  text: string;
  kind: MessageKind;
}

export const done = (text: string): Message => ({ text, kind: "done" });
export const info = (text: string): Message => ({ text, kind: "info" });
export const failed = (text: string): Message => ({ text, kind: "error" });

/** For a screen or region whose every message is of one kind: none while there is no text. */
export const asDone = (text: string | null): Message | null => (text === null ? null : done(text));
export const asFailed = (text: string | null): Message | null => (text === null ? null : failed(text));
export const asInfo = (text: string | null): Message | null => (text === null ? null : info(text));
