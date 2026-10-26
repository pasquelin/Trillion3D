/**
 * WHERE THE CAMERA STANDS IN A PARTITION'S FRAME (`cells.ts`): its eye, its reach and the way it
 * looks in the frame the cells' boxes are written in — the scene root's, which a world may pose
 * (`pose`) —, the rung of rows its view asks, the way the camera heads on the ground, in the
 * world's units (`aimOf`) and in the cells' frame, and how fast it moves there: its average
 * velocity is measured in the world, on its eye and the session's clock, and carried to the cells'
 * frame as a vector, its length stretched as the root stretches it. `moves` counts what made a plan
 * stale though the camera stood: the scene root's world or a core parent's frame moved.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { keepNumbers } from '../../../../math/src/vector/vector.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../../camera/world.ts'
import type { CellBoxes } from './boxes.ts'
import type { CellFrame } from './follow.ts'
import type { CoarserPull } from './coarser.ts'
import { directionInCellFrame, inCellFrame, placedReach, vectorInCellFrame } from './reach.ts'
import { heldSide, rungOf } from './sizing.ts'
import type { StreamingSource } from './source.ts'
import { aimOf, NO_AXIS } from './sourceShape.ts'
import { createSourceVelocity } from './sourceVelocity.ts'

/** The view of a partition hung under `root`, whose cells `boxes` boxes, its grids' reach read
 *  through `source` and `pulls`, the world it hangs in `frame.world`. */
export function createCellView(
  root: Object3D,
  frame: Pick<CellFrame, 'world'>,
  boxes: Pick<CellBoxes, 'refresh' | 'stretch' | 'moves'>,
  partition: Pick<TablePartition, 'cube' | 'hlod'>,
  source: StreamingSource,
  pulls: readonly (CoarserPull | null)[],
) {
  const framed = new Float64Array(MATRIX_VALUES),
    stood = new Float64Array(MATRIX_VALUES).fill(NaN),
    aiming = [0, 0, 0],
    heading = [0, 0, 0],
    moving = [0, 0, 0]
  const velocity = createSourceVelocity()
  /** How many times the scene root's world moved. */
  let worldMoves = 0
  /** The scene root's world, in the frame it hangs in (`pose`). */
  const rootWorld = () => {
    const world = resolveCameraWorld(root).worldMatrix,
      outer = frame.world?.()
    return outer ? multiplyMatrix4(framed, outer, world) : world
  }
  /** The camera at `eye` looking along the unit `axis`, its up vector `up`, at `time` seconds, all
   *  in the world's frame: where it stands in the cells' frame (`eye`, `axis`, `heading` — the way
   *  it heads on the ground — and `velocity`, metres per second), the reach of its grids there,
   *  the rung its view asks, the way it heads in the world's frame (`aim`) and the `moves` that
   *  made the last plan stale. */
  return (eye: ArrayLike<number>, axis?: ArrayLike<number>, up?: ArrayLike<number>, time = 0) => {
    const world = rootWorld()
    if (!keepNumbers(stood, world)) worldMoves++
    const aim = aimOf(axis ?? NO_AXIS, up, aiming)
    const local = inCellFrame(world, eye, placedReach(partition.hlod.grids, source, pulls), axis)
    boxes.refresh()
    const rung = rungOf(heldSide(local.reach, partition.cube, boxes.stretch), partition.cube)
    return {
      ...local,
      rung,
      aim,
      heading: directionInCellFrame(world, aim, heading),
      velocity: vectorInCellFrame(world, velocity.update(eye, time), moving),
      moves: worldMoves + boxes.moves,
    }
  }
}
