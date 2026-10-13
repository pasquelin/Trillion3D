// The engine's composition as a test stand-in: it takes every link (`Engine.composePlacements`) and
// holds its rows at the parent's world times their local, through the composition's own reader
// module (`placement/composeReaders.ts`), as a session without a GPU would give them to a reader.
import {
  dropReaders,
  holdReaders,
  rebindReaders,
  writeReaders,
  type Readers,
} from '../placement/composeReaders.ts'
import type { PlacementRows } from '../placement/rows.ts'
import type { PlacementLink } from '../placement/gpuCompose.ts'

/** A `compose` that accepts every link and writes the rows it holds, telling `update` of each
 *  as the engine reads it (`Engine.updatePlacements`). */
export function composeStandIn(update?: (rows: PlacementRows, from: number, to: number) => void) {
  const readers: Readers = new Map(),
    slots = new Map<object, number>()
  const compose = (
    parent: object,
    world: ArrayLike<number>,
    links: readonly PlacementLink[],
    whole: boolean,
  ) => {
    const slot = slots.get(parent) ?? slots.set(parent, slots.size).get(parent)!
    if (whole) dropReaders(readers, slot)
    holdReaders(readers, slot, parent, links, whole)
    const held = readers.get(slot) ?? [],
      before = held.map(({ rows, index }) => rows.matrices.slice(index * 16, index * 16 + 16))
    writeReaders(readers, slot, world)
    held.forEach(({ rows, index }, k) => {
      const now = rows.matrices.subarray(index * 16, index * 16 + 16)
      if (now.some((v, at) => v !== before[k][at])) update?.(rows, index, index)
    })
  }
  return Object.assign(compose, {
    /** A growth replaced `from` by `to`: the rows it holds are `to`'s now. */
    rebind: (from: PlacementRows, to: PlacementRows) => rebindReaders(readers, from, to),
  })
}
