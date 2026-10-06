import { computeNormals } from '../../../sdk-core/src/world/geometry/normals.ts'
import { hypot3 } from '../../../sdk-core/src/math/primitives/hypot.ts'
import type { CookedSoftBody } from '../../../sdk-core/src/physics/cooked.ts'
import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { Model } from '../physics/tilePlace.ts'

/** Simulation writeback; never a second render mesh or a CPU skin/morph implementation. */
export type SoftSource = {
  rest: Float32Array
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  version: number
  reach: number
}
type SoftDrawn = { softSource?: SoftSource }

/** Attach the versioned cooked source to the existing compiled graph's meshes. */
export function cookedSoftSource(model: Model, soft: CookedSoftBody): SoftSource | undefined {
  const render = soft.render
  if (!render) return undefined
  if (
    render.version !== 1 ||
    render.positions.length !== soft.vertices * 3 ||
    render.indices.some((v) => !Number.isInteger(v) || v < 0 || v >= soft.vertices)
  )
    throw new EngineError('PHYSICS_FORMAT', 'The cooked soft render source is invalid.')
  const graph = model.record.scene?.nodes?.[soft.node]
  if (!graph) throw new EngineError('PHYSICS_FORMAT', 'The cooked soft render node is missing.')
  const rest = Float32Array.from(render.positions)
  const source: SoftSource = {
    rest,
    positions: rest.slice(),
    normals: new Float32Array(rest.length),
    indices: Uint32Array.from(render.indices),
    version: 1,
    reach: 0,
  }
  computeNormals(source.positions, source.indices, source.normals)
  graph.traverse((node) => {
    ;(node as SoftDrawn).softSource = source
  })
  return source
}

/** Copy the physics module's simulation result; normals and reach are simulation writeback
 *  (#573). */
export function receiveSoftSource(source: SoftSource, positions: Float32Array) {
  if (positions.length !== source.positions.length) return false
  source.positions.set(positions)
  computeNormals(source.positions, source.indices, source.normals)
  let reach = 0
  for (let i = 0; i < positions.length; i += 3)
    reach = Math.max(
      reach,
      hypot3(
        positions[i] - source.rest[i],
        positions[i + 1] - source.rest[i + 1],
        positions[i + 2] - source.rest[i + 2],
      ),
    )
  source.reach = reach
  source.version++
  return true
}

/** Copy an image's simulation arrays into the existing deformation record. */
export function writeSoftSource(
  block: Float32Array,
  at: number,
  source: SoftSource,
  first: boolean,
) {
  const n = source.rest.length
  block.copyWithin(at + n, at, at + n)
  block.set(source.positions, at)
  if (first) block.copyWithin(at + n, at, at + n)
  block.set(source.rest, at + n * 2)
  block.set(source.normals, at + n * 3)
}
