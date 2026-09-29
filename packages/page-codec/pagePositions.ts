/**
 * Positions stored once (CMP-10, #960, `docs/FORMAT.md`): a flat-shaded page repeats a corner's
 * position under every face normal meeting there, so it may store its distinct positions and a
 * link per vertex instead — whichever takes fewer words. The decoded vertices are the same.
 */
import { bitsFor } from './pageGrids.ts';
import type { PageCell } from './pageAttributes.ts';

/** Words a stream of `count` fields of `bits` bits occupies. */
const streamWords = (count: number, bits: number) => Math.ceil((count * bits) / 32);

/**
 * The positions the page stores — the distinct ones in first-use order, or one per vertex — and,
 * when distinct, each vertex's link to its own; `bits` are the position record's widths.
 */
export function storedPositions(unique: readonly PageCell[], bits: readonly number[]) {
  const table: number[][] = [],
    rank = new Map<string, number>();
  const links = unique.map(({ p }) => {
    const key = p.join();
    let id = rank.get(key);
    if (id === undefined) rank.set(key, (id = table.push(p) - 1));
    return id;
  });
  const words = (count: number) => bits.reduce((sum, b) => sum + streamWords(count, b), 0);
  const shared =
    words(table.length) + streamWords(unique.length, bitsFor(table.length - 1)) <
    words(unique.length);
  return shared
    ? { stored: table, links, linkBits: bitsFor(table.length - 1) }
    : { stored: unique.map(({ p }) => p), links: null, linkBits: 0 };
}
