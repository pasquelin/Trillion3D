/**
 * WHERE THE CAMERA STANDS IN A PARTITION'S FRAME (`cells.ts`): its eye, its reach and the way it
 * looks in the frame the cells' boxes are written in — the scene root's, which a world may pose
 * (`pose`) —, the rung of rows its view asks, the scene root's world and the way the camera heads
 * on the ground, in the world's units (`aimOf`) and in the cells' frame.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../../camera/world.ts'
import type { CellBoxes } from './boxes.ts'
import type { CellFrame } from './follow.ts'
import type { CoarserPull } from './coarser.ts'
import { inCellFrame, placedReach } from './reach.ts'
import { heldSide, rungOf } from './sizing.ts'
import type { StreamingSource } from './source.ts'
import { aimOf } from './sourceShape.ts'

/** The view of a partition hung under `root`, whose cells `boxes` boxes, its grids' reach read
 *  through `source` and `pulls`, the world it hangs in `frame.world`. */
export function createCellView(
  root: Object3D,
  frame: Pick<CellFrame, 'world'>,
  boxes: Pick<CellBoxes, 'refresh' | 'stretch'>,
  partition: Pick<TablePartition, 'cube' | 'hlod'>,
  source: StreamingSource,
  pulls: readonly (CoarserPull | null)[],
) {
  const framed = new Float64Array(MATRIX_VALUES),
    aiming = [0, 0, 0]
  /** The scene root's world, in the frame it hangs in (`pose`). */
  const rootWorld = () => {
    const world = resolveCameraWorld(root).worldMatrix,
      outer = frame.world?.()
    return outer ? multiplyMatrix4(framed, outer, world) : world
  }
  /** The camera at `eye` looking along the unit `axis`, its up vector `up`, all in the world's
   *  frame: where it stands in the cells' frame (`eye`, `axis`, and `heading`, the way it heads
   *  on the ground), the reach of its grids there, the rung its view asks, the scene root's
   *  `world` and the way it heads in the world's frame (`aim`). */
  return (eye: ArrayLike<number>, axis?: ArrayLike<number>, up?: ArrayLike<number>) => {
    const world = rootWorld()
    const aim = axis && up ? aimOf(axis, up, aiming) : axis
    const local = inCellFrame(world, eye, placedReach(partition.hlod.grids, source, pulls), axis)
    const heading = aim && aim !== axis ? inCellFrame(world, eye, 0, aim).axis : local.axis
    boxes.refresh()
    const rung = rungOf(heldSide(local.reach, partition.cube, boxes.stretch), partition.cube)
    return { ...local, rung, world, aim, heading }
  }
}
