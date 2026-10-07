import { entriesIdentity } from './entriesIdentity.ts'
import { adoptEntries, sameEntries } from '../../gpu/core/sameEntries.ts'

/** Resource snapshots for a family. Entry descriptors and snapshot arrays grow only at setup;
 *  stable images read the same descriptors without rebuilding entry arrays or bindings. */
export type WebgpuBindIdentity = {
  /** Where the family writes, every time it is read, what its groups currently name. */
  next: unknown[]
  /** Canonical live entry lists, shared with createBindGroup. */
  entries: GPUBindGroupEntry[][]
  /** True when `next` differs from every identity held; the identity then holds `next`, in place
   *  of the one named longest ago. */
  moved(): boolean
  /** Writes the family's layout then every list of `entries` into `next`, and returns `moved()`. */
  entriesMoved(layout: unknown): boolean
  /** Where the identity `next` named at the last `moved()` is held, below `depth`: the family keeps
   *  the groups it made for it at that rank, and makes them again when `moved()` was true. */
  readonly slot: number
}

/**
 * The identity of a family's groups: the resources they name. It holds the last `depth` it was
 * given, each at its `slot`. With a depth of two, a family whose resources take turns frame after
 * frame — a double-buffered set, its current frame's then the other's — finds each of them held
 * and keeps a group for each, where a single identity would move, and its groups be made again,
 * every frame.
 */
export function createWebgpuBindIdentity(depth = 1): WebgpuBindIdentity {
  /** The identities held, by slot, and when each was last named. */
  const held: unknown[][] = [[]],
    named = [0],
    next: unknown[] = [],
    entries: GPUBindGroupEntry[][] = []
  let clock = 0
  const identity = {
    next,
    entries,
    slot: 0,
    moved() {
      clock++
      for (let at = 0; at < held.length; at++)
        if (sameEntries(held[at], next)) {
          identity.slot = at
          named[at] = clock
          return false
        }
      let at = held.length
      if (at === depth) {
        at = 0
        for (let k = 1; k < depth; k++) if (named[k] < named[at]) at = k
      }
      adoptEntries((held[at] ??= []), next)
      identity.slot = at
      named[at] = clock
      return true
    },
    entriesMoved(layout: unknown) {
      next[0] = layout
      let at = 1
      for (let i = 0; i < entries.length; i++) at = entriesIdentity(entries[i], next, at)
      next.length = at
      return identity.moved()
    },
  }
  return identity
}

/** True when every resource an entry list names exists: the readiness of its group. */
export function entriesReady(entries: readonly GPUBindGroupEntry[]) {
  for (let i = 0; i < entries.length; i++) {
    const resource = entries[i].resource
    if (!resource || ('buffer' in resource && !resource.buffer)) return false
  }
  return true
}
