import {
  BODY_INDEX,
  LAYER,
  MOTION,
  SHAPE,
  physicsMatterOf,
  type CommandWriter,
} from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { createModelBodies } from './modelBodies.ts'
import { moversOf, nearness, tilePose, type Placed } from './tilePlace.ts'

/** Gives tile `p` a body and restores its cooked `bytes` into it: built into one static body, its
 *  handle dropped, the body keeping the shape. */
export function restoreTile(
  writer: CommandWriter,
  bodies: ReturnType<typeof createPhysicsBodies>,
  p: Placed,
  bytes: Uint8Array,
) {
  p.id = bodies.claim(p.tile.bytes, 0, { model: p.model, tile: p })
  const handle = p.id & BODY_INDEX
  const { position, quaternion, scale } = tilePose(p)
  // The matter the node's collider declares, over the engine's default, as for every body.
  const matter = physicsMatterOf(p.instance)
  // Restored, built into one static body, and its handle dropped: the body keeps the shape.
  writer.restore(handle, bytes)
  writer.add({
    ...{ id: p.id, motion: MOTION.static, layer: LAYER.static, shape: SHAPE.cooked },
    ...{ flags: 0, position, quaternion, size: [scale.x, scale.y, scale.z] },
    ...{ mass: 0, density: 0, friction: matter.friction, restitution: matter.restitution },
    ...{ gravityScale: 1, indices: [handle] },
  })
  writer.release(handle)
}

/** The tiles still wanted, each with its nearness, and the bytes the resident ones hold; a tile
 *  out of range, or one a declared body holds, is evicted on the way. */
export function wantedTiles(
  openings: Iterable<{ placed: Placed[] }>,
  bodies: ReturnType<typeof createPhysicsBodies>,
  declared: ReturnType<typeof createModelBodies>,
  evict: (p: Placed) => void,
  eye: ArrayLike<number>,
  range: number,
) {
  const wanted: [number, Placed][] = [],
    movers = moversOf(bodies.meshes, bodies.nested, bodies.state.velocity)
  let held = 0 // What the wanted resident tiles hold.
  for (const { placed } of openings)
    for (const p of placed) {
      const near = nearness(p, eye, range, movers)
      if (near === Infinity || declared.holds(p.model, p.instance.node)) evict(p)
      else wanted.push([near, p])
      if (p.id >= 0) held += p.tile.bytes
    }
  return { wanted, held }
}
