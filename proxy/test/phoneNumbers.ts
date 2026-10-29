/**
 * What is, and isn't, a phone number to the leak check (proxy/src/boundary.ts), shared with the app's own copy of the check (ui/src/core/identifiers.ts) so
 * both are held to the same table. All synthetic: numbers in ranges set aside for drama and examples.
 */

/** Forms in use: each is taken whole for a phone number. */
export const PHONE_NUMBERS = [
  "07700 900123",
  "07700900123",
  "07700 900 123",
  "02079460958",
  "020 7946 0958",
  "020-7946-0958",
  "0121 496 0123",
  "0 7700 900 123",
  "0800 123 4567",
  "0 800 123 4567",
  "+44 20 7946 0958",
  "+44 7700 900123",
  "+44 7700 900 123",
  "+44 (0)20 7946 0958",
  "+44 (0) 20 7946 0958",
  "+44 (20) 7946 0958",
  "+44(0)2079460958",
  "+44-20-7946-0958",
  "+44 20 7946-0958",
  "+447700900123",
  "+4407700900123",
  "0044 20 7946 0958",
  "0033 1 23 45 67 89",
  "0054 9 11 2345 6789", // fifteen digits with its leading zero
  "+54 9 11 2345 6789",
  "+1 555 010 0001",
  "+1-555-010-0001",
  "+1 (555) 010-0001",
  "+1 555.010.0001",
  "+33 1 23 45 67 89",
  "+33123456789",
  "+49 30 123456",
  "+81 90 1234 5678",
  "+7 495 123-45-67",
  "+358 40 123 4567",
  "01 23 45 67 89",
  "01.23.45.67.89",
  "+44.20.7946.0958",
  "020.7946.0958",
  "+44 20.7946.0958",
] as const;

/** A phone number with a bracket round its area code is found without the opening bracket, which is not part of the number. */
export const PHONE_NUMBERS_IN_BRACKETS = ["(020) 7946 0958", "(+44) 20 7946 0958"] as const;

/** Scores, rows of decimals, counts, versions and dates: never a phone number. */
export const NOT_PHONE_NUMBERS = [
  "0.156 0.20 0.206 0.00 0",
  "00 2.23 1 14 1.28",
  "10.0 20.0 30.0 40.0 50.0",
  "10.00 20.00 30.00 40.00 50.00",
  "12 0.5 0.25 0.125 0.0625 0.03125",
  "0.5 0.25 0.125 0.0625 0.03125 0.015625",
  "(0.12 0.34 0.56 0.78 0.90)",
  "1.0 0.0 1.0 0.0 1.0 0.0 1.0 0.0 1.0",
  "0.0.0.0.0.0.0.0.0.0",
  "0.1234567890",
  "0.987654321",
  "0 1 2 3 4 5 6 7 8 9",
  "0 12 7 8 9 33 4 5 6",
  "scores 0 4 2 7 1 9 3 5 8",
  "0 0 0 0 0 0 0 0 0 0",
  "1,000 000 0000",
  "version 0.9.1.2.3",
  "2026-10-28",
] as const;

/** Phone numbers in their surroundings: after punctuation that doesn't continue another number, or inside brackets. The number alone is what is found. */
export const PHONE_NUMBERS_IN_CONTEXT = [
  ["Contact,01.23.45.67.89", "01.23.45.67.89"],
  ["Contact:01.23.45.67.89", "01.23.45.67.89"],
  ["tel:07700 900123", "07700 900123"],
  ["(07700 900123)", "07700 900123"],
  ["Call:+44 20 7946 0958", "+44 20 7946 0958"],
  [";020 7946 0958", "020 7946 0958"],
  ["and,020-7946-0958", "020-7946-0958"],
  ["x,+44 20 7946 0958", "+44 20 7946 0958"],
  ["ring/0121 496 0123", "0121 496 0123"],
] as const;

/** Runs that end, or begin, inside a longer run of numbers: the whole run is scores or counts, so no fragment of it is a phone number. */
export const NOT_PHONE_NUMBER_FRAGMENTS = [
  "0 12 34 56 78 90.5",
  "0 12 34 56 78 90.12",
  "78.90 0 12 34 56 78 90",
  "0 1 2 3 0 12 34 56 78 90",
  "1.5 0 12 34 56 78 90",
  "0 1 2 3 0 12 34 56 78 9",
] as const;
