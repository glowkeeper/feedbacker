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

/** How long the AI has been working, for the neutral message that says so: nothing in the first few seconds, then in seconds, then in minutes and seconds. */
export const elapsedText = (seconds: number): string => (seconds < 5 ? "" : seconds < 60 ? ` ${seconds} s` : ` ${Math.floor(seconds / 60)} min ${seconds % 60} s`);

/** The note when a download came without its report (for example, once unzipped without it), so failed downloads can't be counted. */
export const NO_REPORT =
  "No download report (for example manifest.txt) was found among the files, so whether any file failed to download couldn't be checked. Check that the number of files is what you expected, or choose the download's report with the rest.";
