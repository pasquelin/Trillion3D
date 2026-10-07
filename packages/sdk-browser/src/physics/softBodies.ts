import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import {
  BODY_INDEX,
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
import type { Bodied } from './bodies.ts'

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

/** The soft body drawn into each geometry. */
const drawers = new WeakMap<Geometry, Mesh>()
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
