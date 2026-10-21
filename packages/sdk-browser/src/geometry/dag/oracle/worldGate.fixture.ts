import { worldOf, dagRecords } from '../records.fixture.ts'
import type { PackedDag } from '../types.ts'
import { ACTOR_ROW, CELL_DRAW, LINK_WORDS } from '../worlds/worldLinks.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

/** The word of HLOD cell `h` of instance `k` as the host last wrote it (`../worlds/worldFollow.ts`). */
const stateOf = (packed: PackedDag, k: number, h: number) => {
  const world = packed.world!
  return world.states[k * world.cells + h]
}

/** The CPU mirror of `worldCovers` (`../shader/worldGateWgsl.ts`): whether a placement opens
 *  nothing, neither its file's word nor its HLOD 0 cell's drawing its placements; one in neither
 *  always opens; a row of a cell's actor opens while its cell draws that actor, never in an
 *  instance not packed. */
export const oracleWorldCovers = (packed: PackedDag) => (w: number) => {
  const world = packed.world
  if (!world) return false
  const h = world.links[w * LINK_WORDS],
    k = world.links[w * LINK_WORDS + 1],
    f = world.links[w * LINK_WORDS + 2]
  if (h === NO_INDEX && f === NO_INDEX) return false
  if (h !== NO_INDEX && h & ACTOR_ROW)
    return k === NO_INDEX || (stateOf(packed, k, h & ~ACTOR_ROW) & CELL_DRAW.hlod) === 0
  let drawn = f === NO_INDEX ? 0 : world.files[f]
  if (h !== NO_INDEX) drawn |= stateOf(packed, k, h)
  return (drawn & CELL_DRAW.placements) === 0
}

/** The CPU mirror of `worldHides` — and of `worldNodeHides`, whose nodes hold one actor's pages
 *  alone: whether packed page `i` is a world cluster whose cell does not draw its actor, neither
 *  drawn nor asked for. */
export function oracleWorldHides(packed: PackedDag) {
  const world = packed.world
  if (!world) return () => false
  const records = dagRecords(packed)
  return (i: number) => {
    const w = worldOf(records, i),
      k = world.roots.indexOf(w)
    if (k < 0) return false
    return (stateOf(packed, k, world.hlod[i - packed.cutLinks[w].pageBase]) & CELL_DRAW.hlod) === 0
  }
}
