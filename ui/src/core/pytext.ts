/**
 * Python's whitespace, for `strip()` and `split()` ported from the reference.
 * It differs from JavaScript's `\s`: Python also counts \x1c-\x1f and \x85,
 * and doesn't count ﻿.
 */

/** Python's whitespace as a regular-expression character class body (also what `re` means by `\\s`). */
export const WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const EDGES = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");
const RUNS = new RegExp(`[${WS}]+`);

/** Python's `str.strip()`. */
export const pyStrip = (s: string) => s.replace(EDGES, "");

const ALL = new RegExp(`^[${WS}]+$`);

/** Python's `str.isspace()`: non-empty and all whitespace. */
export const isPySpace = (s: string) => ALL.test(s);

/** Python's `str.split()` with no arguments. */
export const pySplit = (s: string) => pyStrip(s).split(RUNS).filter((w) => w !== "");

// --- Python's line breaks -----------------------------------------------------------

const LINE_BREAKS = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** Python's `str.splitlines()`. */
export function pySplitlines(s: string): string[] {
  const lines = s.split(LINE_BREAKS);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// --- Python's numbers ---------------------------------------------------------------

/**
 * Unicode decimal digits as ASCII, as Python's `int()` and `float()` read
 * them. Decimal digits come in runs of ten, from zero, so a digit's value is
 * its distance from the start of its run, modulo ten.
 */
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (d) => {
    let start = d.codePointAt(0)!;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((d.codePointAt(0)! - start) % 10);
  });
}

/**
 * `int()` and `float()` strip less than `str.strip()`: only ASCII space, tab
 * and line breaks, and non-ASCII whitespace; not \x1c-\x1f.
 */
const NUM_WS = "\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const NUM_EDGES = new RegExp(`^[${NUM_WS}]+|[${NUM_WS}]+$`, "g");
const numStrip = (s: string) => s.replace(NUM_EDGES, "");

const DIGITS = "[0-9](?:_?[0-9])*";
const PY_INT = new RegExp(`^[+-]?${DIGITS}$`);
const PY_FLOAT = new RegExp(`^[+-]?(?:(?:${DIGITS})?\\.${DIGITS}|${DIGITS}\\.?)(?:[eE][+-]?${DIGITS})?$`);
const PY_SPECIAL = /^([+-]?)(inf|infinity|nan)$/i;

/** Python's `float(s)` for a string, or null where Python raises ValueError. */
export function pyFloat(s: string): number | null {
  const text = asciiDigits(numStrip(s));
  const special = PY_SPECIAL.exec(text);
  if (special) return special[2].toLowerCase() === "nan" ? NaN : special[1] === "-" ? -Infinity : Infinity;
  return PY_FLOAT.test(text) ? Number(text.replaceAll("_", "")) : null;
}

/** Python's `int(s)` for a string, or null where Python raises ValueError. */
export function pyInt(s: string): bigint | null {
  const text = asciiDigits(numStrip(s));
  return PY_INT.test(text) ? BigInt(text.replaceAll("_", "")) : null;
}

/** Python's `repr(float)` (and `str(float)`): shortest digits, as in "85.0", "1e-05", "1e+16". */
export function pyReprFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x < 0 ? "-inf" : "inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mantissa, exp] = x.toExponential().split("e"); // shortest round-trip digits
  return layout(mantissa.startsWith("-"), mantissa.replace(/^-/, "").replace(".", ""), Number(exp), 16, true);
}

/** Python's `format(x, "g")`: six significant digits, rounded half to even on the exact value. */
export function pyFormatG(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x < 0 ? "-inf" : "inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const [digits, exp] = roundSignificant(Math.abs(x), 6);
  return layout(x < 0, digits.replace(/0+$/, "") || "0", exp, 6, false);
}

/** Place a decimal point in `digits` (d.ddd × 10^exp) as Python's float formatting does. */
function layout(negative: boolean, digits: string, exp: number, maxExp: number, keepPoint: boolean): string {
  const sign = negative ? "-" : "";
  if (exp < -4 || exp >= maxExp) {
    const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${mantissa}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  let fixed: string;
  if (exp < 0) fixed = `0.${"0".repeat(-exp - 1)}${digits}`;
  else if (digits.length > exp + 1) fixed = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
  else fixed = digits + "0".repeat(exp + 1 - digits.length) + (keepPoint ? ".0" : "");
  return sign + fixed;
}

/** The exact value of a positive finite double as numerator / denominator. */
function exactRatio(x: number): [bigint, bigint] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const exp2 = (biased === 0 ? 1 : biased) - 1075;
  return exp2 >= 0 ? [mantissa << BigInt(exp2), 1n] : [mantissa, 1n << BigInt(-exp2)];
}

/** `precision` significant digits of positive `x`, rounded half to even, and the decimal exponent. */
function roundSignificant(x: number, precision: number): [string, number] {
  const [num, den] = exactRatio(x);
  let exp = Math.floor(Math.log10(x));
  // Correct the estimate so that 10^exp <= x < 10^(exp + 1), exactly.
  const pow = (e: number) => 10n ** BigInt(Math.abs(e));
  const atLeast = (e: number) => (e >= 0 ? num >= den * pow(e) : num * pow(e) >= den);
  while (!atLeast(exp)) exp--;
  while (atLeast(exp + 1)) exp++;
  const shift = exp - (precision - 1); // x / 10^shift has `precision` integer digits
  const n = shift >= 0 ? num : num * pow(shift);
  const d = shift >= 0 ? den * pow(shift) : den;
  let q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && q % 2n === 1n)) q++;
  let digits = q.toString();
  if (digits.length > precision) {
    digits = digits.slice(0, precision); // rounded up to a power of ten
    exp++;
  }
  return [digits, exp];
}

// --- Python's repr() of JSON values ---------------------------------------------------

/** A JSON number as Python's `json` reads it: an int when written without a point or exponent. */
export class PyJsonNumber {
  readonly source: string;
  constructor(source: string) {
    this.source = source;
  }
  get isInt(): boolean {
    return /^-?\d+$/.test(this.source);
  }
  get value(): number {
    return Number(this.source);
  }
  toString(): string {
    return this.isInt ? BigInt(this.source).toString() : pyReprFloat(Number(this.source));
  }
}

const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** Python's `repr(str)`. */
export function pyReprStr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch !== " " && NON_PRINTABLE.test(ch)) {
      out += cp < 0x100 ? `\\x${cp.toString(16).padStart(2, "0")}` : cp < 0x10000 ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\U${cp.toString(16).padStart(8, "0")}`;
    } else out += ch;
  }
  return out + quote;
}

/** Python's `str()` of a value parsed from JSON (with numbers kept as `PyJsonNumber`). */
export function pyStr(value: unknown): string {
  return typeof value === "string" ? value : pyRepr(value);
}

/** Python's `repr()` of a value parsed from JSON. */
export function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return pyReprStr(value);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : pyReprFloat(value);
  if (value instanceof PyJsonNumber) return value.toString();
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  const entries = value instanceof Map ? [...value] : Object.entries(value as object);
  return `{${entries.map(([k, v]) => `${pyReprStr(k)}: ${pyRepr(v)}`).join(", ")}}`;
}

/** Python's truthiness of a value parsed from JSON. */
export function pyTruthy(value: unknown): boolean {
  if (value instanceof PyJsonNumber) return value.value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Map) return value.size > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Parse JSON as Python's `json` module reads it: objects as `Map`s, keeping
 * their members in written order (JavaScript objects put integer-like keys
 * first) with the last of a repeated key winning in the first one's place,
 * and numbers as `PyJsonNumber`, keeping their text (85 and 85.0 differ in
 * Python). The text is validated by `JSON.parse` first, so errors are the
 * engine's own. Python also accepts NaN and Infinity, which JSON doesn't;
 * this refuses them.
 */
export function parsePyJson(text: string): unknown {
  JSON.parse(text); // throws SyntaxError for anything that isn't JSON
  let i = 0;
  const space = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++;
  };
  const value = (): unknown => {
    space();
    const c = text[i];
    if (c === "{") {
      i++;
      const object = new Map<string, unknown>();
      space();
      if (text[i] === "}") return i++, object;
      while (true) {
        space();
        const key = string();
        space();
        i++; // :
        object.set(key, value());
        space();
        if (text[i++] === "}") return object; // otherwise ","
      }
    }
    if (c === "[") {
      i++;
      const array: unknown[] = [];
      space();
      if (text[i] === "]") return i++, array;
      while (true) {
        array.push(value());
        space();
        if (text[i++] === "]") return array; // otherwise ","
      }
    }
    if (c === '"') return string();
    for (const [word, literal] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) return (i += word.length), literal;
    }
    const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    number.lastIndex = i;
    const lexeme = number.exec(text)![0];
    i += lexeme.length;
    return new PyJsonNumber(lexeme);
  };
  const string = (): string => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  return value();
}
