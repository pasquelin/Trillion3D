/**
 * Identity of the resources a family of bind groups names, compared in place.
 *
 * A bind group is a function of the resources it cites: when one of them is replaced — a resized
 * page pool, a reallocated page table, another atlas layer count, a backdrop that followed the
 * viewport — every group that cited it is stale, whoever replaced it. So no path keeps a list of
 * the groups to drop: each family writes the identities it depends on into `next` before serving a
 * group, and voids itself when one of them moved. The two arrays are allocated once; an image that
 * moved nothing compares a few references and allocates nothing.
 */
export type WebgpuBindIdentity = {
  /** Where the family writes, every time it is read, what its groups currently name. */
  next: unknown[];
  /** True when `next` differs from what was held; the identity then holds `next`. */
  moved(): boolean;
};

export function createWebgpuBindIdentity(size: number): WebgpuBindIdentity {
  const held: unknown[] = new Array(size).fill(undefined),
    next: unknown[] = new Array(size).fill(undefined);
  return {
    next,
    moved() {
      let moved = false;
      for (let i = 0; i < size; i++)
        if (held[i] !== next[i]) {
          held[i] = next[i];
          moved = true;
        }
      return moved;
    },
  };
}
