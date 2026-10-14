/**
 * WHAT A ROOT'S WORLD DECIDES ON THE CPU, TAKEN WHEN READ: its world box — its local box carried by
 * its world — and its stretch — `maxStretch`, the largest singular value of its linear part, in
 * doubles. The GPU derives both for every root whose world moved, the one home every pass reads
 * (`../../placement/rootBoxes.ts`, the box in the roots' boxes, the stretch in the frame words'
 * field the cut projects its errors through); the CPU takes them for the readers that decide on
 * the CPU in the frame that asks — the deformation's screen-size skip (`../../deformation/screen.ts`)
 * and the shadow box of a deformation (`noteDeformed`) —, the same doubles, never sent.
 *
 * Each is a memo keyed by the world's stamp: `worldAt`, which `worldMoved` moves at each place the
 * engine takes a world that moved — a root made (`collect.ts`, `../../scene/worldRecords.ts`), a
 * move (`../../webgpu/pages/render/movedRoot.ts`), a row its owner wrote (`../../placement/update.ts`)
 * —, and the `stamp` of a world a parent composes (`../../placement/gpuComposeWorld.ts`). A move
 * costs the CPU one increment: the box and the stretch are taken at the first read after it, by the
 * one reader that asks, never for a root no reader asks. A box read before a move is taken is the
 * one the root leaves.
 */
import { boxTransform } from '../../../../math/src/geometry/box.ts'
import { maxStretch } from '../../../../math/src/projection/projectionOracles.ts'
import type { MatrixElements } from '../../host/matrixElements.ts'

/** A root's world and what its memos hold. */
export type WorldMemo = {
  world: MatrixElements
  worldAt?: number
  localBox?: Float64Array
  worldBox?: Float64Array
  boxAt?: number
  boxStamp?: number
  stretch?: number
  stretchAt?: number
  stretchStamp?: number
}

/** The world of `root` moved: what is derived from it is taken again at its next read. */
export function worldMoved(root: Pick<WorldMemo, 'worldAt'>) {
  root.worldAt = (root.worldAt ?? 0) + 1
}

/** The stamp of a world a parent composes; none for another. */
const stampOf = (world: MatrixElements) => (world as { stamp?: number }).stamp

/** Whether a memo taken at `at` and `stamp` still holds for `root`'s world. A root no move was
 *  ever taken of holds the box it was made with. */
const holds = (root: WorldMemo, at: number | undefined, stamp: number | undefined) =>
  at === root.worldAt && stamp === stampOf(root.world)

/** `root`'s world box, its local box at its world, taken now when its world moved since; none
 *  without one. The array is the root's own: read, never kept past the next move. */
export function rootWorldBox(root: WorldMemo) {
  const box = root.worldBox
  if (!box || !root.localBox || holds(root, root.boxAt, root.boxStamp)) return box
  boxTransform(box, 0, root.localBox, 0, root.world.elements)
  root.boxAt = root.worldAt
  root.boxStamp = stampOf(root.world)
  return box
}

/** `root`'s stretch, taken now when its world moved since. */
export function worldStretch(root: WorldMemo) {
  if (root.stretch !== undefined && holds(root, root.stretchAt, root.stretchStamp))
    return root.stretch
  root.stretchAt = root.worldAt
  root.stretchStamp = stampOf(root.world)
  return (root.stretch = maxStretch(root.world.elements))
}
