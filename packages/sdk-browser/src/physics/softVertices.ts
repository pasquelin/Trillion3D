// The soft bodies' drawn vertices: each simulated state kept in two steps by slot, every frame
// drawn at the bodies' time into the page's geometry or a compiled model's source.
import { receiveSoftSource } from '../deformation/softSource.ts'
import { BODY_INDEX, SOFT_STATE_WORDS } from '../../../sdk-core/src/physics/index.ts'
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { computeNormals } from '../../../sdk-core/src/world/geometry/normals.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { TickRecords } from './protocol.ts'
import { createTwoSteps, eachRecord } from './twoSteps.ts'
import { lerpArray } from '../../../math/src/scalar/reals.ts'

/** The soft body drawing now (`drawSoft`), if any. */
let drawing: Mesh | null = null
/** Whether `node`'s change is its soft body drawn where it is: no new shape to simulate. */
export const drawnBySoft = (node: object) => node === drawing

/** Draws `mesh` where its soft body is: its geometry's positions, and its float normals
 *  when it carries some, rewritten in place from `vertices`, one simulated place per vertex. */
function drawSoft(mesh: Mesh, vertices: Float32Array) {
  const { position, normal } = mesh.geometry.attributes
  if (position?.kind !== 'attribute' || position.array.length !== vertices.length) return
  drawing = mesh
  try {
    position.array.set(vertices)
    position.needsUpdate = true
    const normals = normal?.kind === 'attribute' ? normal.array : null
    const floats = normals instanceof Float32Array || normals instanceof Float64Array
    if (!floats || normals.length !== vertices.length) return
    computeNormals(vertices, mesh.geometry.index?.array ?? null, normals)
    normal!.needsUpdate = true
  } finally {
    drawing = null
  }
}

/** A soft body's simulated vertices, two states (`twoSteps.ts`, 3 numbers a vertex), under its
 *  engine id. */
type SoftState = { id: number; from: Float32Array; to: Float32Array }

/**
 * The soft bodies' drawn vertices (`SOFT_STATE_WORDS` records): each one's simulated vertices kept
 * in two states by slot (`twoSteps.ts`), and each frame every vertex of a soft body's geometry
 * drawn at the bodies' time, on the line between the two places of the simulated vertex it maps
 * to, in `physics.vertices`, its geometry drawn there (`drawSoft`); a compiled model's at the same
 * places (`receiveSoftSource`). A record naming a body that left is skipped.
 */
export function createSoftVertices(
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'meshOf' | 'softMap' | 'slots'>,
  capacity: number,
) {
  const steps2 = createTwoSteps(capacity)
  const bySlot: (SoftState | undefined)[] = []
  /** The simulated vertices drawn, grown to the most a soft body held. */
  let drawn = new Float32Array(0)
  /** The source of the compiled model's soft body `id`, or none. */
  const sourceOf = (id: number) => {
    const owner = bodies.slots.of(id)
    return owner && 'soft' in owner ? owner.soft.source : undefined
  }
  /** The page's soft body `id` and its vertex map, or none. */
  const meshOf = (id: number) => {
    const mesh = bodies.meshOf(id),
      map = mesh && bodies.softMap(mesh.physics._index)
    return map ? { mesh: mesh!, map } : null
  }
  /** Whether the soft body `id` is still simulated: a page's or a compiled model's. */
  const drawable = (id: number) => !!(sourceOf(id) || meshOf(id))
  /** Draws the soft body in `slot` at `t` of its step. */
  const draw = (slot: number, t: number) => {
    const { id, from, to } = bySlot[slot]!,
      source = sourceOf(id),
      page = meshOf(id)
    let vertices = to
    if (t !== 1) {
      if (drawn.length < to.length) drawn = new Float32Array(to.length)
      vertices = drawn.subarray(0, to.length)
      lerpArray(vertices, from, to, t)
    }
    if (source) receiveSoftSource(source, vertices)
    if (!page) return
    const { mesh, map } = page
    // Made again from another geometry, it takes the new one's vertex count.
    if (mesh.physics.vertices?.length !== map.length * 3)
      mesh.physics.vertices = new Float32Array(map.length * 3)
    const out = mesh.physics.vertices
    for (let v = 0; v < map.length; v++)
      for (let k = 0; k < 3; k++) out[v * 3 + k] = vertices[map[v] * 3 + k]
    drawSoft(mesh, out)
  }
  /** Whether the soft body kept in `slot` is still simulated; one gone gives its states back. */
  const alive = (slot: number) => {
    const state = bySlot[slot]
    if (state && drawable(state.id)) return true
    bySlot[slot] = undefined
    return false
  }
  return {
    /** A tick's records, after `steps` fixed steps; returns how many it kept. */
    receive(records: TickRecords | null, steps: number) {
      let kept = 0
      steps2.begin(steps)
      if (records)
        eachRecord(records, SOFT_STATE_WORDS, 3, (id, newest, before) => {
          if (!drawable(id)) return
          const slot = id & BODY_INDEX
          let state = bySlot[slot]
          const fresh = state?.id !== id || state.to.length !== newest.length
          if (fresh) {
            const size = newest.length
            bySlot[slot] = state = { id, from: new Float32Array(size), to: new Float32Array(size) }
          }
          if (steps2.record(slot, state!, newest, before, fresh)) kept++
        })
      steps2.end((slot) => draw(slot, 1))
      return kept
    },
    /** Draws every moving soft body at `t` of its step (`along`), `waiting` while the page waits
     *  for the worker's next state; whether any is still on its way. */
    apply(t: number, waiting: boolean) {
      if (!steps2.count) return false
      steps2.keep(alive)
      for (let i = 0; i < steps2.count; i++) draw(steps2.moving[i], t)
      return steps2.settle(t, waiting)
    },
  }
}
