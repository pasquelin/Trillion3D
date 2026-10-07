import {
  BODY_INDEX,
  LAYER,
  MOTION,
  SHAPE,
  physicsMatterOf,
  type CommandWriter,
} from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { SharedShapes } from './sharedShapes.ts'
import { tilePose, type Placed } from './tilePlace.ts'

/**
 * The tile bodies resident in the physics module: each placement's static body built on its
 * tile's restored shape (`sharedShapes.ts`), holding its own pose and scale and one body of the
 * budget, and a user of that shape until it leaves. `held` counts them.
 */
export function createResidentTiles(
  writer: CommandWriter,
  bodies: ReturnType<typeof createPhysicsBodies>,
  shapes: SharedShapes,
) {
  const held = { bodies: 0 }
  const evict = (p: Placed) => {
    if (p.id < 0) return
    bodies.release(p.id & BODY_INDEX)
    p.id = -1
    shapes.done(p.shape)
    held.bodies--
  }
  return {
    held,
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
      shapes.use(p.shape)
      held.bodies++
    },
    /** Leaves tile `p` out, its body removed. */
    evict,
    /** Takes tile `p` out for good — its model leaving, its tile or its body refused —, once: its
     *  body removed, its tile let go of; its opening drops it at the next update (`want`). */
    remove(p: Placed) {
      if (p.out) return
      evict(p)
      p.out = true
      shapes.letGo(p.shape)
      // Its tile let go of by all: the placements it waited with let go of too.
      if (!p.shape.holders) p.shape.waiting.length = p.shape.waits = 0
    },
  }
}
