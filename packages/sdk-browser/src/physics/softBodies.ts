import { receiveSoftSource } from '../deformation/softSource.ts'
import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import {
  BODY_INDEX,
  SOFT_STATE_WORDS,
  SOFT_VERTEX_WORDS,
  physicsMatterOf,
  softBodyOf,
  writeSoft,
  type CommandWriter,
  type ObjectPhysics,
  type SoftBodyRecord,
} from '../../../sdk-core/src/physics/index.ts'
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { computeNormals } from '../../../sdk-core/src/world/geometry/normals.ts'
import { type Bodied, type createPhysicsBodies } from './bodies.ts'
import type { TickRecords } from './protocol.ts'
import { createTwoSteps, eachRecord, lerpInto } from './twoSteps.ts'

type Pose = { position: ArrayLike<number>; quaternion: ArrayLike<number> }

/** How far, relatively, a soft body's world scale may stray from the one it was made at. */
const SCALE_TOLERANCE = 1e-4
const near = (s: number, at: number) => Math.abs(s - at) <= SCALE_TOLERANCE * Math.abs(at)
/** Whether `scale`, a soft body's world scale, is `at`, the one it was made (or cooked) at. */
export const fits = (scale: { x: number; y: number; z: number }, at: ArrayLike<number>) =>
  near(scale.x, at[0]) && near(scale.y, at[1]) && near(scale.z, at[2])

/** The refusal of soft body `what`, made at scale `at` and placed at another: the physics module scales no soft
 *  body once made. `names` say which. */
export const rescaledSoft = (what: string, at: ArrayLike<number>, names: Record<string, unknown>) =>
  new EngineError(
    'PHYSICS_FAILED',
    `The soft body ${what} was made at scale ${Array.from(at).join(', ')}: it is placed at another.`,
    names,
  )

/**
 * Writes the SOFT command of body `id`, made with the options `p` over the matter `matter` of its
 * material or its cooked collider, placed by `pose` and simulated at `scale`: a page-built and a
 * cooked soft body mapped alike. Its options win over the matter, as `obj.physics` wins. SOFT has
 * no flags word: its `flags` (`flagsOf`), when any, follow in FLAGS.
 */
export function writeSoftBody(
  writer: CommandWriter,
  id: number,
  p: ObjectPhysics,
  matter: { friction: number; restitution: number },
  pose: Pose & Pick<SoftBodyRecord, 'scale'>,
  record: SoftBodyRecord['record'],
  flags: number,
) {
  writeSoft(writer, {
    ...{ id, ...pose },
    ...{
      friction: p.friction ?? matter.friction,
      restitution: p.restitution ?? matter.restitution,
    },
    ...{ gravityScale: p.gravityScale, linearDamping: p.damping.linear },
    ...{ settings: p.soft!, record },
  })
  if (flags) writer.flags(id & BODY_INDEX, flags)
}

/** The soft body drawn into each geometry; the one drawing now (`drawSoft`), if any. */
const drawers = new WeakMap<Geometry, Mesh>()
let drawing: Mesh | null = null
/** Whether `node`'s change is its soft body drawn where it is: no new shape to simulate. */
export const drawnBySoft = (node: object) => node === drawing

/**
 * Writes the SOFT command of `mesh`, a soft body placed at `pose` and scaled by `size`, simulated
 * in fixed steps of `step` seconds: its slot claimed with its vertices counted against the
 * budget, its vertex map kept in `maps`, its `flags` written. Returns the slot. A geometry
 * another soft body draws itself into is refused.
 */
export function addSoftBody(
  writer: CommandWriter,
  mesh: Bodied,
  pose: Pose,
  size: { x: number; y: number; z: number },
  claim: (collisionBytes: number, softVertices: number) => number,
  maps: (Uint32Array | null)[],
  flags: number,
  step: number,
) {
  const p = mesh.physics,
    other = drawers.get(mesh.geometry)
  if (other && other !== mesh && other.geometry === mesh.geometry && other.physics?._host)
    throw new EngineError(
      'PHYSICS_FAILED',
      `The soft body ${mesh.name || '(unnamed)'} shares its geometry with ${other.name || 'another'}: give each its own (geometry.clone()).`,
      { name: mesh.name, shares: other.name },
    )
  drawers.set(mesh.geometry, mesh)
  const record = softBodyOf(mesh.geometry, size, { ...p.soft!, mass: p.mass }, step)
  const id = claim(0, record.vertices.length / SOFT_VERTEX_WORDS)
  // Its vertices move every step: uploaded in place, never cut into pages again.
  mesh.geometry.usage = 'dynamic'
  const scale = [size.x, size.y, size.z] as const
  writeSoftBody(writer, id, p, physicsMatterOf(mesh.material), { ...pose, scale }, record, flags)
  maps[id & BODY_INDEX] = record.map
  return id & BODY_INDEX
}

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
      lerpInto(vertices, from, to, t)
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
