/**
 * Where the lists for choosing a range of a brief with no headings start: at the blocks of the range already chosen, so saving
 * again without changing them keeps it, or else the whole text.
 */
export function rangeBounds(blocks: { start: number; end: number }[], saved: { start: number; end: number }[] | null): { from: number; to: number } {
  const last = Math.max(blocks.length - 1, 0);
  if (!saved || saved.length !== 1) return { from: 0, to: last };
  const first = blocks.findIndex((b) => b.start >= saved[0].start);
  const end = blocks.findLastIndex((b) => b.end <= saved[0].end);
  return { from: first >= 0 ? first : 0, to: end >= 0 ? end : last };
}
