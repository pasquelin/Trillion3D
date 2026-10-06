/** Record builders the physics tests share, free of Node: a page or a worker imports them too. */
import { GENERATION_SHIFT } from '../../../sdk-core/src/physics/index.ts'

/** Generation 1 of an engine id. */
const GENERATION = 1 << GENERATION_SHIFT
/** Generation 1 of slot `slot`'s engine id. */
export const id = (slot: number) => slot | GENERATION

/** A box body for the ADD command: engine id `id`, a motion, its height and half size. */
export const body = (id: number, motion: number, y: number, half: number, flags = 0) => ({
  id,
  motion,
  layer: motion === 0 ? 0 : 1,
  shape: 0 as const,
  flags,
  position: [0, y, 0],
  quaternion: [0, 0, 0, 1],
  size: [half, half, half] as const,
  mass: 0,
  density: 600,
  friction: 0.5,
  restitution: 0,
  gravityScale: 1,
})

/** Laid flat: the plane's `+y` turned to the world's `−z`, so its `−z` is the world's down. */
export const FLAT: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]
