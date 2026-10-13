/**
 * WHAT A ROOT'S WORLD DECIDES ON THE CPU, TAKEN WHEN READ: its world box — its local box carried by
 * its world — and its stretch — `maxStretch`, the largest singular value of its linear part, in
 * doubles. Each is a memo keyed by the world's stamp: `worldAt`, which `worldMoved` moves at each
 * place the engine takes a world that moved — a move (`../../webgpu/pages/render/movedRoot.ts`), a
 * row its owner wrote (`../../placement/update.ts`), a root taken (`collect.ts`,
 * `../../scene/worldRecords.ts`) —, and the `stamp` of a world a parent composes
 * (`../../placement/gpuComposeWorld.ts`). A move costs the CPU one increment: the box and the
 * stretch are taken at the first read after it, by the one reader that asks, never for a move no
 * one reads. The GPU derives its own from the world it holds (`../../placement/rootBoxes.ts`), the
 * same doubles.
 *
 * A reader of the box a root leaves reads it before its move is taken, at the stamp it holds. Where
 * the owner writes a world in place before the engine takes it — a row's view —, the box of the
 * last stamp must have been read when that stamp was taken: the follow that takes a row reads the
 * box it enters (`followPlacementRows`), and a root taken reads its own (`takeWorldBox`).
 */
import { boxTransform, maxStretch } from '../../../../sdk-core/src/index.ts'
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

/** A root taken: its world moved, and its box at that world read now — the box its first move
 *  leaves, should its owner write the world in place before it is taken again. */
export function takeWorldBox(root: WorldMemo) {
  worldMoved(root)
  rootWorldBox(root)
}

/** `root`'s stretch, taken now when its world moved since. */
export function worldStretch(root: WorldMemo) {
  if (root.stretch !== undefined && holds(root, root.stretchAt, root.stretchStamp))
    return root.stretch
  root.stretchAt = root.worldAt
  root.stretchStamp = stampOf(root.world)
  return (root.stretch = maxStretch(root.world.elements))
}
