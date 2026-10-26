/**
 * The files each row of the name-matching table offers. A file is offered to a row unless another row has chosen it,
 * so a file released from one student (set to "Not matched") can be given to another, and no file is given to two.
 */
export function optionsFor(pool: string[], picks: Record<string, string>, pseudonym: string): string[] {
  return pool.filter((name) => name === picks[pseudonym] || !Object.entries(picks).some(([other, file]) => other !== pseudonym && file === name));
}
