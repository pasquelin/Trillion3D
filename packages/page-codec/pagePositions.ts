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
  const { distinct: table, ranks: links } = firstUse(
    unique.map(({ p }) => p),
    (p) => p.join(),
  );
  const words = (count: number) => bits.reduce((sum, b) => sum + streamWords(count, b), 0),
    linkBits = bitsFor(table.length - 1);
  return words(table.length) + streamWords(unique.length, linkBits) < words(unique.length)
    ? { stored: table, links, linkBits }
    : { stored: unique.map(({ p }) => p), links: null, linkBits: 0 };
}

/** Each distinct item once, in first-use order, and every item's rank among them, items being
 *  alike when their `key` is. */
export function firstUse<T>(items: readonly T[], key: (item: T) => string) {
  const distinct: T[] = [],
    rank = new Map<string, number>();
  const ranks = items.map((item) => {
    const k = key(item);
    let id = rank.get(k);
    if (id === undefined) rank.set(k, (id = distinct.push(item) - 1));
    return id;
  });
  return { distinct, ranks };
}
