import { worldOf, dagRecords } from '../records.fixture.ts'
import type { PackedDag } from '../types.ts'
import { CELL_DRAW, placementDraws } from '../worlds/worldLinks.ts'

/** The word of HLOD cell `h` of instance `k` as the host last wrote it (`../worlds/worldFollow.ts`). */
const stateOf = (packed: PackedDag, k: number, h: number) => {
  const world = packed.world!
  return world.states[k * world.cells + h]
}

/** The CPU mirror of `worldCovers` (`../shader/worldGateWgsl.ts`): whether a placement opens
 *  nothing, by the host's own rule (`placementDraws`, `../worlds/worldLinks.ts`) — the shader it is
 *  proved against is the one written apart. */
export const oracleWorldCovers = (packed: PackedDag) => (w: number) =>
  packed.world ? !placementDraws(packed.world, w) : false

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
