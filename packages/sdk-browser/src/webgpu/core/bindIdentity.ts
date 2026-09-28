/** Resource snapshots for a family. Entry descriptors and snapshot arrays grow only at setup;
 *  stable images read the same descriptors without rebuilding entry arrays or bindings. */
export type WebgpuBindIdentity = {
  /** Where the family writes, every time it is read, what its groups currently name. */
  next: unknown[];
  /** Canonical live entry lists, shared with createBindGroup. */
  entries: GPUBindGroupEntry[][];
  /** True when `next` differs from what was held; the identity then holds `next`. */
  moved(): boolean;
};

export function createWebgpuBindIdentity(): WebgpuBindIdentity {
  const held: unknown[] = [],
    next: unknown[] = [];
  return {
    next,
    entries: [],
    moved() {
      let moved = held.length !== next.length;
      held.length = next.length;
      for (let i = 0; i < next.length; i++)
        if (held[i] !== next[i]) {
          held[i] = next[i];
          moved = true;
        }
      return moved;
    },
  };
}

/** Reads exactly the resources and ranges supplied to createBindGroup, into reused storage. */
export function entriesIdentity(entries: readonly GPUBindGroupEntry[], next: unknown[], at = 0) {
  for (const entry of entries) {
    const resource = entry.resource;
    next[at++] = entry.binding;
    if (resource && 'buffer' in resource) {
      next[at++] = resource.buffer;
      next[at++] = resource.offset ?? 0;
      next[at++] = resource.size;
    } else next[at++] = resource;
  }
  return at;
}
