import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { Seat } from './worldBatches.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { touchRows, type PoseState } from './worldPoseState.ts'

/** A sprite's row, rewritten at every write (`spriteRow`). */
const spriteScratch = new Float64Array(16)

/**
 * The row of a sprite: where it stands and its scale on `x` and `y`, all the rasters read of it
 * (`spriteAt`), never its turn — a sprite is drawn by its position and its axes'
 * lengths alone. Its third axis, which no raster reads, is `(m − x, m − y, m)`, `m` the larger
 * scale: the cube of its pages (`runtimePrimitive.ts`), of half-width `r`, then spans `r·m` on
 * every axis of the world — the farthest a corner lies from the origin once scaled, whichever way
 * the camera or the material's rotation turns it, a long side laid along any world axis included.
 */
function spriteRow(world: ArrayLike<number>) {
  const x = hypot3(world[0], world[1], world[2]),
    y = hypot3(world[4], world[5], world[6]),
    m = Math.max(x, y)
  spriteScratch.fill(0)
  spriteScratch[0] = x
  spriteScratch[5] = y
  spriteScratch[8] = m - x
  spriteScratch[9] = m - y
  spriteScratch[10] = m
  for (let i = 12; i < 15; i++) spriteScratch[i] = world[i]
  spriteScratch[15] = 1
  return spriteScratch
}

/** Writes one seated mesh's world matrix — a sprite's row (`spriteRow`) — and flags into its
 *  row: whether it is shown, and whether it casts no shadow. */
export function writeSeat(state: PoseState, mesh: Mesh, seat: Seat, shown: boolean) {
  const rows = seat.batch.rows
  if (!rows || seat.row < 0) return
  const world = mesh.matrixWorld.elements
  rows.matrices.set(mesh.primitive === 'sprite' ? spriteRow(world) : world, seat.row * 16)
  rows.live[seat.row] = shown ? 1 : 0
  rows.shadowless[seat.row] = mesh.castShadow ? 0 : 1
  touchRows(state, seat.batch, seat.row, seat.row)
}
