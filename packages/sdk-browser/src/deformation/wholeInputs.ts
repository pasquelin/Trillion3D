import { skinStreams } from '../../../sdk-core/src/world/geometry/skin.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { readComponent } from '../../../sdk-core/src/world/geometry/bounds.ts'
import { FLAG_SKIN, FLAG_SOFT_SOURCE } from '../../../sdk-core/src/page/format.ts'

/** Simulated vertices a soft source id may name, unless the caller gives its own bound. */
const SOFT_VERTICES = 65536

/** Throws `PHYSICS_FORMAT` unless `ids` names one simulated vertex below `softVertices` for each
 *  of `count` vertices. */
function checkSoftSourceIds(count: number, ids: readonly number[], softVertices = SOFT_VERTICES) {
  if (
    ids.length !== count ||
    ids.some((id) => !Number.isInteger(id) || id < 0 || id >= softVertices)
  )
    throw new Error('PHYSICS_FORMAT')
}

/** The header of a whole copy's inputs, its floats in order: the flags, the target count, the
 *  vertex count, the stride of a vertex's row; the rows follow (`floats`). */
export const WHOLE_HEADER = { flags: 0, targets: 1, vertices: 2, stride: 3, floats: 4 } as const
/** A vertex's row: its joints, then its weights (`width` each), then a morph target's floats each
 *  target, its position's delta then its normal's (from `normal`). */
export const WHOLE_TARGET = { floats: 6, normal: 3 } as const

/** Whole-mesh transmission keeps its source representation; inputs are packed once per geometry. */
export function wholeDeformationInputs(
  geometry: Geometry,
  softSourceIds?: readonly number[],
  softVertices = SOFT_VERTICES,
) {
  const count = geometry.attributes.position?.count ?? 0
  const targets = geometry.morphAttributes.position ?? []
  const streams = skinStreams(geometry),
    width = softSourceIds ? 4 : streams.width
  const skin = width > 0
  if (softSourceIds) checkSoftSourceIds(count, softSourceIds, softVertices)
  const stride = 2 * width + targets.length * WHOLE_TARGET.floats
  // The header (`WHOLE_HEADER`), then one row of source attributes per vertex.
  const data = new Float32Array(WHOLE_HEADER.floats + count * stride)
  data[WHOLE_HEADER.flags] = softSourceIds ? FLAG_SOFT_SOURCE | FLAG_SKIN : skin ? FLAG_SKIN : 0
  data[WHOLE_HEADER.targets] = targets.length
  data[WHOLE_HEADER.vertices] = count
  data[WHOLE_HEADER.stride] = stride
  for (let vertex = 0; vertex < count; vertex++) {
    let at = WHOLE_HEADER.floats + vertex * stride
    if (skin) {
      for (let k = 0; k < width; k++) {
        data[at + k] = softSourceIds ? softSourceIds[vertex] : streams.read(vertex, k, false)
        data[at + width + k] = softSourceIds ? Number(k === 0) : streams.read(vertex, k, true)
      }
      at += 2 * width
    }
    for (let t = 0; t < targets.length; t++) {
      const normal = geometry.morphAttributes.normal?.[t]
      for (let c = 0; c < 3; c++) {
        data[at + c] =
          readComponent(geometry, targets[t], vertex, c) -
          (geometry.morphTargetsRelative
            ? 0
            : readComponent(geometry, geometry.attributes.position, vertex, c))
        if (normal)
          data[at + WHOLE_TARGET.normal + c] =
            readComponent(geometry, normal, vertex, c) -
            (geometry.morphTargetsRelative || !geometry.attributes.normal
              ? 0
              : readComponent(geometry, geometry.attributes.normal, vertex, c))
      }
      at += WHOLE_TARGET.floats
    }
  }
  return data
}
