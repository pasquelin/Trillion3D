import { CORNER_INFLUENCES, type CutDeformation } from '../../../../sdk-core/src/contracts/proxy.ts'
import type { DrawnDeformation } from '../../../../sdk-core/src/world/geometry/drawnDeformation.ts'

/** Floats of one corner: its joint ranks, its weights, then three deltas a morph target. */
const cornerFloats = (targets: number) => 2 * CORNER_INFLUENCES + 3 * targets

/**
 * What poses a cut's proxy (`CutDeformation`): for each corner of each triangle the proxy holds, the skin
 * and the morph deltas of the vertex that corner stands on. `sources[t]` is the rank, among the cut's
 * triangles, of the triangle the proxy's triangle `t` was built from (`proxy.rs`, `Built.sources`), and
 * `indices` names the vertices of that triangle: the corner `k` of triangle `t` stands on vertex
 * `indices[3 × sources[t] + k]`. A skin keeps its four heaviest influences, in its weights' order; a
 * vertex of fewer influences keeps zero weights past them.
 */
export function cornerDeformation(
  sources: Uint32Array,
  indices: Uint32Array,
  deformation: DrawnDeformation,
): CutDeformation | undefined {
  const { joints, weights, targets, influences = CORNER_INFLUENCES } = deformation
  const skinned = !!joints && !!weights
  if (!skinned && !targets.length) return undefined
  const width = cornerFloats(targets.length)
  const corners = new Float32Array(sources.length * 3 * width)
  for (let t = 0; t < sources.length; t++)
    for (let k = 0; k < 3; k++) {
      const vertex = indices[3 * sources[t] + k]
      const at = (t * 3 + k) * width
      if (skinned) {
        // The heaviest influences first: a vertex of eight keeps its four largest.
        const order = Array.from({ length: influences }, (_, i) => i)
          .sort((a, b) => weights![vertex * influences + b] - weights![vertex * influences + a])
          .slice(0, CORNER_INFLUENCES)
        order.forEach((influence, slot) => {
          corners[at + slot] = joints![vertex * influences + influence]
          corners[at + CORNER_INFLUENCES + slot] = weights![vertex * influences + influence]
        })
      }
      targets.forEach((target, n) => {
        for (let axis = 0; axis < 3; axis++)
          corners[at + 2 * CORNER_INFLUENCES + 3 * n + axis] = target.positions[vertex * 3 + axis]
      })
    }
  return { targets: targets.length, corners }
}
