import type { PageRec } from '../../page/selection/selection.ts';

/**
 * The lower residency tier: the pages the light cuts asked for, in their order — highest
 * replacement error first — each with the groups it closes over (`../cut/groupClosure.ts`),
 * without repeats, and no longer than the pool. The camera's tier is
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
  closeOver: (ids: ArrayLike<number>, visit: (id: number) => void) => void;
}) {
  const { packedPages, keyOf, room, closeOver } = options;
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
  const push = (id: number) => {
    const rec = packedPages[id];
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
      closeOver(ids, push);
    },
    /** The CPU light cuts' wanted pages, one list per redrawn face. */
    offerPages(lists: ReadonlyArray<readonly PageRec[]>, count: number) {
      begin();
      for (let run = 0; run < count; run++)
        closeOver(
          lists[run].map((rec) => rec.packedIndex ?? -1).filter((id) => id >= 0),
          push,
        );
    },
  };
}
