import {
  BODY_INDEX,
  LAYER,
  MOTION,
  SHAPE,
  physicsMatterOf,
  type CommandWriter,
} from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { tilePose, type Placed, type TileShape } from './tilePlace.ts'

/**
 * The cooked tiles resident in the physics module. A tile's shape is restored once, under a handle
 * of its own (`CommandWriter.restore`), its bytes counted once against the static collision's
 * share; each placement's static body is built on it, holding its own pose and scale and one body
 * of the budget; the shape is released once its last body has left, never before. `held` is what
 * they hold: the shapes' bytes and the bodies.
 */
export function createResidentTiles(
  writer: CommandWriter,
  bodies: ReturnType<typeof createPhysicsBodies>,
) {
  const held = { bytes: 0, bodies: 0 }
  /** Shapes left without a body since the last `settle`: released there, unless built on again. */
  const bare: TileShape[] = []
  return {
    held,
    /** Restores `shape` from its cooked `bytes`, for the bodies built on it next. */
    restore(shape: TileShape, bytes: Uint8Array) {
      bodies.countShape(shape.tile.bytes)
      shape.handle = writer.restore(bytes)
      held.bytes += shape.tile.bytes
      bare.push(shape)
    },
    /** Builds tile `p`'s static body on its restored shape. */
    build(p: Placed) {
      p.id = bodies.claim(0, 0, { model: p.model, tile: p })
      const { position, quaternion, scale } = tilePose(p)
      // The matter the node's collider declares, over the engine's default, as for every body.
      const matter = physicsMatterOf(p.instance)
      writer.add({
        ...{ id: p.id, motion: MOTION.static, layer: LAYER.static, shape: SHAPE.cooked },
        ...{ flags: 0, position, quaternion, size: [scale.x, scale.y, scale.z] },
        ...{ mass: 0, density: 0, friction: matter.friction, restitution: matter.restitution },
        ...{ gravityScale: 1, indices: [p.shape.handle] },
      })
      p.shape.bodies++
      held.bodies++
    },
    /** Leaves tile `p` out, its body removed: its shape bare once that body was its last. */
    evict(p: Placed) {
      p.out = true
      if (p.id < 0) return
      bodies.release(p.id & BODY_INDEX)
      p.id = -1
      held.bodies--
      if (!--p.shape.bodies) bare.push(p.shape)
    },
    /** Releases every shape still without a body: its handle dropped, its bytes given back. */
    settle() {
      for (const shape of bare)
        if (!shape.bodies && shape.handle >= 0) {
          writer.release(shape.handle)
          bodies.countShape(-shape.tile.bytes)
          held.bytes -= shape.tile.bytes
          shape.handle = -1
        }
      bare.length = 0
    },
  }
}
