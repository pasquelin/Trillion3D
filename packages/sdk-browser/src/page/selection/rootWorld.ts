/**
 * WHAT A ROOT'S WORLD DECIDES ON THE CPU, TAKEN WHEN READ: its stretch — `maxStretch`, the largest
 * singular value of its linear part, in doubles —, a memo keyed by the world's stamp: `worldAt`,
 * which `worldMoved` moves wherever the engine takes a world that moved (`moveRootRows`), and the
 * `stamp` of a world a parent composes (`../../placement/gpuComposeWorld.ts`). A move costs the CPU
 * one increment: the stretch is solved at the first read after it, never for a move no one reads.
 * The GPU derives its own from the world it holds (`../../placement/rootBoxes.ts`), the same doubles.
 */
import { maxStretch } from '../../../../sdk-core/src/index.ts'
import type { MatrixElements } from '../../host/matrixElements.ts'

/** A root's world and what its memo holds. */
export type WorldMemo = {
  world: MatrixElements
  worldAt?: number
  localBox?: Float64Array
  worldBox?: Float64Array
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

/** Whether a memo taken at `at` and `stamp` still holds for `root`'s world. */
const holds = (root: WorldMemo, at: number | undefined, stamp: number | undefined) =>
  at === root.worldAt && stamp === stampOf(root.world)

/** `root`'s stretch, taken now when its world moved since. */
export function worldStretch(root: WorldMemo) {
  if (root.stretch !== undefined && holds(root, root.stretchAt, root.stretchStamp))
    return root.stretch
  root.stretchAt = root.worldAt
  root.stretchStamp = stampOf(root.world)
  return (root.stretch = maxStretch(root.world.elements))
}
