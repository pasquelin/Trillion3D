/** Resource snapshots for a family. Entry descriptors and snapshot arrays grow only at setup;
 *  stable images read the same descriptors without rebuilding entry arrays or bindings. */
export type WebgpuBindIdentity = {
  /** Where the family writes, every time it is read, what its groups currently name. */
  next: unknown[];
  /** Canonical live entry lists, shared with createBindGroup. */
  entries: GPUBindGroupEntry[][];
  /** True when `next` differs from what was held; the identity then holds `next`. */
  moved(): boolean;
  /** Writes the family's layouts then every list of `entries` into `next`, and returns `moved()`. */
  entriesMoved(layout: unknown, other?: unknown): boolean;
};

export function createWebgpuBindIdentity(): WebgpuBindIdentity {
  const held: unknown[] = [],
    next: unknown[] = [],
    entries: GPUBindGroupEntry[][] = [];
  const moved = () => {
    let moved = held.length !== next.length;
    held.length = next.length;
    for (let i = 0; i < next.length; i++)
      if (held[i] !== next[i]) {
        held[i] = next[i];
        moved = true;
      }
    return moved;
  };
  return {
    next,
    entries,
    moved,
    entriesMoved(layout, other) {
      next[0] = layout;
      next[1] = other;
      let at = 2;
      for (let i = 0; i < entries.length; i++) at = entriesIdentity(entries[i], next, at);
      next.length = at;
      return moved();
    },
  };
}

/** Reads exactly the resources and ranges supplied to createBindGroup, into reused storage. */
export function entriesIdentity(entries: readonly GPUBindGroupEntry[], next: unknown[], at = 0) {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i],
      resource = entry.resource;
    next[at++] = entry.binding;
    if (resource && 'buffer' in resource) {
      next[at++] = resource.buffer;
      next[at++] = resource.offset ?? 0;
      next[at++] = resource.size;
    } else next[at++] = resource;
  }
  return at;
}

/** True when every resource an entry list names exists: the readiness of its group. */
export function entriesReady(entries: readonly GPUBindGroupEntry[]) {
  for (let i = 0; i < entries.length; i++) {
    const resource = entries[i].resource;
    if (!resource || ('buffer' in resource && !resource.buffer)) return false;
  }
  return true;
}
