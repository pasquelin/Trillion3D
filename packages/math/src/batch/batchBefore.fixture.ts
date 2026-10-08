// The batches before they wrote their unit function's formula in the loop, word for word but their
// names: each a loop over the unit function, the oracles `batchMoves.test.ts` holds the shipped
// ones to.
import { BOX_VALUES } from '../geometry/box.ts'
import { frustumExcludesBox } from '../geometry/frustum/box.ts'
import { sphereFromBounds } from '../geometry/sphere.ts'
import { transformAffinePoint, transformDirectionVector3 } from '../vector/vector.ts'
import { POSITION_VALUES, SPHERE_VALUES } from './strides.ts'

export function transformPointsBatchBefore(
  out: Float64Array | Float32Array,
  m: ArrayLike<number>,
  points: ArrayLike<number>,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES
    transformAffinePoint(out, m, points[at], points[at + 1], points[at + 2], at)
  }
}

export function transformDirectionsBatchBefore(
  out: Float64Array,
  m: ArrayLike<number>,
  dirs: ArrayLike<number>,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const at = i * POSITION_VALUES
    transformDirectionVector3(out, m, dirs[at], dirs[at + 1], dirs[at + 2], at)
  }
}

export function frustumKeepsBoxBatchBefore(
  kept: Uint8Array,
  planes: Float64Array,
  boxes: ArrayLike<number>,
  n: number,
): number {
  let count = 0
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES
    const excluded = frustumExcludesBox(
      planes,
      boxes[at],
      boxes[at + 1],
      boxes[at + 2],
      boxes[at + 3],
      boxes[at + 4],
      boxes[at + 5],
    )
    kept[i] = excluded ? 0 : 1
    if (!excluded) count++
  }
  return count
}

export function sphereFromBoundsBatchBefore(
  out: Float64Array,
  boxes: ArrayLike<number>,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const src = i * BOX_VALUES
    sphereFromBounds(
      out,
      i * SPHERE_VALUES,
      boxes[src],
      boxes[src + 1],
      boxes[src + 2],
      boxes[src + 3],
      boxes[src + 4],
      boxes[src + 5],
    )
  }
}
