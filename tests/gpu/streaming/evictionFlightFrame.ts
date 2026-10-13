// What one frame of the eviction flight read back says (`evictionFlightPage.ts`): the pages it
// drew against the pool it read — its own copy, made after its cut — and against the cut an
// unbounded pool draws at the same pose.

/** What one frame read back says. */
export type FlightFrame = {
  frame: number
  /** Drawn pages, increasing. */
  drawn: number[]
  /** Drawn pages whose slot did not hold their bytes when the frame read it, or that its
   *  residency did not name. */
  torn: number[]
  /** Leaf units, by copy, the cut covers zero times where the unbounded pool's covers them, or
   *  twice. */
  holes: number
  overdraw: number
  /** Pages the unbounded pool draws at this pose. */
  reference: number[]
  /** Pages resident, and the closure of what the cut asks for. */
  resident: number
  wanted: number
}

/**
 * Frame `drawn`'s faults: each drawn page whose slot, as the frame's tables named it (`at`), did not
 * hold its bytes in the pool the frame read (`words`) — or that the frame's residency did not name
 * —, the leaf units `reference` covers and `drawn` does not, and those `drawn` covers twice.
 */
export function readFlightFrame(
  world: {
    units: readonly (readonly [number, number])[]
    copyOf: (page: number) => number
    dag: { leaves: number }
  },
  drawn: readonly number[],
  reference: readonly number[],
  at: { flags: Uint8Array; offsets: Int32Array },
  words: Uint32Array,
) {
  const torn = drawn.filter((page) => {
    const offset = at.offsets[page]
    return (
      !at.flags[page] || offset < 0 || words[offset] !== page || words[offset + 1] !== ~page >>> 0
    )
  })
  const covered = (list: readonly number[]) => {
    const hits = new Map<number, number>()
    for (const page of list)
      for (let u = world.units[page][0]; u < world.units[page][1]; u++) {
        const unit = world.copyOf(page) * world.dag.leaves + u
        hits.set(unit, (hits.get(unit) ?? 0) + 1)
      }
    return hits
  }
  const got = covered(drawn),
    want = covered(reference)
  let holes = 0,
    overdraw = 0
  for (const unit of want.keys()) if (!got.has(unit)) holes++
  for (const n of got.values()) if (n > 1) overdraw++
  return { torn, holes, overdraw }
}
