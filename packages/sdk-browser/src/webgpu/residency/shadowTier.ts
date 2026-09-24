import type { PageRec } from '../../page/selection/selection.ts';

/**
 * The lower residency tier: the pages the light cuts asked for, in their order — highest
 * replacement error first — without repeats, and no longer than the pool. The camera's tier is
 * served first and pinned; this one only fills what the camera leaves (`residentEnsurer.ts`).
 *
 * The list is replaced whole each time a frame's light cuts report: a frame that redraws no
 * shadow page reports nothing, and the last list stands — a still scene asks for nothing new.
 */
export function createShadowTier(options: {
  packedPages: readonly PageRec[];
  keyCount: number;
  keyOf: (page: PageRec) => number;
  room: () => number;
}) {
  const { packedPages, keyOf, room } = options;
  const pages: PageRec[] = [];
  const stamps = new Uint32Array(Math.max(1, options.keyCount));
  let stamp = 0;
  const begin = () => {
    pages.length = 0;
    if (++stamp === 0xffffffff) {
      stamps.fill(0);
      stamp = 1;
    }
  };
  const push = (rec: PageRec | undefined) => {
    if (!rec || pages.length >= room()) return;
    const key = keyOf(rec);
    if (stamps[key] === stamp) return;
    stamps[key] = stamp;
    pages.push(rec);
  };
  return {
    pages,
    /** True when the last light-cut report names this key: a caster a light still wants. */
    has: (key: number) => stamp !== 0 && stamps[key] === stamp,
    /** The light cuts' GPU requests: page indices of the packed catalogue. */
    offerIds(ids: ArrayLike<number>) {
      begin();
      for (let i = 0; i < ids.length; i++) push(packedPages[ids[i]]);
    },
    /** The CPU light cuts' wanted pages, one list per redrawn face. */
    offerPages(lists: ReadonlyArray<readonly PageRec[]>, count: number) {
      begin();
      for (let run = 0; run < count; run++) for (const rec of lists[run]) push(rec);
    },
  };
}
