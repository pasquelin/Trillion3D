import { worldOf, dagRecords } from '../records.fixture.ts'
import type { PackedDag } from '../types.ts'
import { CELL_DRAW, LINK_WORDS, PLACEMENT_BITS } from '../worldLinks.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

/** The word of HLOD cell `h` of instance `k` as the host last wrote it (`../worldFollow.ts`). */
const stateOf = (packed: PackedDag, k: number, h: number) => {
  const world = packed.world!
  return world.states[k * world.cells + h]
}

/** The CPU mirror of `worldStateOf` (`../shader/worldGateWgsl.ts`): the word of placement `w`'s
 *  HLOD 0 cell, its placements drawn for one in no cell. */
function placementState(packed: PackedDag, w: number) {
  const world = packed.world
  const h = world ? world.links[w * LINK_WORDS] : NO_INDEX
  if (!world || h === NO_INDEX) return CELL_DRAW.placements
  return stateOf(packed, world.links[w * LINK_WORDS + 1], h)
}

/** The CPU mirror of `worldCovers`: whether a placement opens nothing, its HLOD 0 cell neither
 *  drawing nor asking for its placements. */
export const oracleWorldCovers = (packed: PackedDag) => (w: number) =>
  (placementState(packed, w) & PLACEMENT_BITS) === 0

/** The CPU mirror of `worldWaits`: whether a placement asks for its pages and draws none. */
export const oracleWorldWaits = (packed: PackedDag) => (w: number) =>
  (placementState(packed, w) & PLACEMENT_BITS) === CELL_DRAW.asking

/** The CPU mirror of `worldHides`: whether packed page `i` is a world cluster whose cell does not
 *  draw its actor, neither drawn nor asked for. */
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
