/**
 * Python's `csv.reader` and `csv.DictReader` in the default ("excel")
 * dialect: comma-separated, `"` quoting with doubled quotes, not strict. A
 * port of CPython's `_csv.c` state machine, reading text as `io.StringIO`
 * gives it: line by line, split after each `\n`.
 */

export class CsvError extends Error {}

const FIELD_LIMIT = 131072; // csv.field_size_limit()

type State = "start_record" | "start_field" | "in_field" | "in_quoted_field" | "quote_in_quoted_field" | "eat_crnl";

/** Every row, as Python's `csv.reader` gives them (a blank line is an empty row). */
export function csvRows(text: string): string[][] {
  const lines = text.split(/(?<=\n)/).filter((l) => l !== "");
  const rows: string[][] = [];
  let state: State = "start_record";
  let fields: string[] = [];
  let field = "";
  let fieldLength = 0;
  const add = (c: string) => {
    if (++fieldLength > FIELD_LIMIT) throw new CsvError(`field larger than field limit (${FIELD_LIMIT})`);
    field += c;
  };
  const save = () => {
    fields.push(field);
    field = "";
    fieldLength = 0;
  };
  /** One character, or null for the end of a line. */
  const step = (c: string | null) => {
    const newline = c === "\n" || c === "\r";
    switch (state) {
      case "start_record":
        if (c === null) return;
        if (newline) {
          state = "eat_crnl";
          return;
        }
        state = "start_field";
      // falls through
      case "start_field":
        if (newline || c === null) {
          save();
          state = c === null ? "start_record" : "eat_crnl";
        } else if (c === '"') state = "in_quoted_field";
        else if (c === ",") save();
        else {
          add(c);
          state = "in_field";
        }
        return;
      case "in_field":
        if (newline || c === null) {
          save();
          state = c === null ? "start_record" : "eat_crnl";
        } else if (c === ",") {
          save();
          state = "start_field";
        } else add(c);
        return;
      case "in_quoted_field":
        if (c === null) return;
        if (c === '"') state = "quote_in_quoted_field";
        else add(c);
        return;
      case "quote_in_quoted_field":
        if (c === '"') {
          add(c);
          state = "in_quoted_field";
        } else if (c === ",") {
          save();
          state = "start_field";
        } else if (newline || c === null) {
          save();
          state = c === null ? "start_record" : "eat_crnl";
        } else {
          add(c);
          state = "in_field";
        }
        return;
      case "eat_crnl":
        if (newline) return;
        if (c === null) {
          state = "start_record";
          return;
        }
        throw new CsvError("new-line character seen in unquoted field - do you need to open the file with newline=''?");
    }
  };

  let i = 0;
  while (true) {
    // One record, which may span several lines inside quotes.
    fields = [];
    field = "";
    fieldLength = 0;
    state = "start_record";
    let ended = false;
    do {
      if (i >= lines.length) {
        ended = true;
        break;
      }
      for (const c of lines[i++]) step(c);
      step(null);
    } while (state !== "start_record");
    if (ended) {
      if (fieldLength !== 0 || (state as State) === "in_quoted_field") {
        save();
        rows.push(fields);
      }
      return rows;
    }
    rows.push(fields);
  }
}

/**
 * Rows as `csv.DictReader` gives them: keyed by the first row's names, with
 * blank lines skipped. Extra values go under a `null` key and missing ones are
 * `null`, as Python's `restkey` and `restval` default to None.
 */
export function csvDictRows(text: string): { fieldnames: string[] | null; rows: Map<string | null, string | string[] | null>[] } {
  const all = csvRows(text);
  const fieldnames = all.length ? all[0] : null;
  const rows = all
    .slice(1)
    .filter((row) => row.length > 0)
    .map((row) => {
      const names = fieldnames ?? [];
      const d = new Map<string | null, string | string[] | null>();
      names.forEach((name, i) => d.set(name, i < row.length ? row[i] : null));
      // dict(zip(...)) stops at the shorter; then restkey or restval fill in.
      for (let i = row.length; i < names.length; i++) d.set(names[i], null);
      if (row.length > names.length) d.set(null, row.slice(names.length));
      return d;
    });
  return { fieldnames, rows };
}
