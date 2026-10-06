import type { createPhysicsBodies } from './bodies.ts'
import type { createModelBodies } from './modelBodies.ts'
import { moversOf, nearness, type Placed } from './tilePlace.ts'

/** What the static collision's share and the body budget leave the tiles: bytes and bodies. */
type TileRoom = { bytes: number; bodies: number }

/** The tiles still wanted, each with its nearness; a tile out of range, or one a declared body
 *  holds, is evicted on the way. */
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
  for (const { placed } of openings)
    for (const p of placed) {
      const near = nearness(p, eye, range, movers)
      if (near === Infinity || declared.holds(p.model, p.instance.node)) evict(p)
      else wanted.push([near, p])
    }
  return wanted
}

/**
 * Which of the `wanted` tiles, nearest first, are in within `free`: a tile's shape counted once,
 * at its nearest placement in, each placement one body. Past the first that does not fit, the
 * farther are out and evicted, the room kept for the nearer; a tile past the whole share never
 * fits, and holds no one back. `pass` names this update.
 */
export function admitTiles(
  wanted: readonly [number, Placed][],
  free: TileRoom,
  pass: number,
  evict: (p: Placed) => void,
) {
  let [bytes, bodies, full] = [free.bytes, free.bodies, false]
  for (const [, p] of wanted) {
    const { shape } = p,
      more = shape.counted === pass ? 0 : shape.tile.bytes
    p.out = shape.tile.bytes > free.bytes || (full ||= more > bytes || bodies < 1)
    if (p.out) {
      evict(p)
      continue
    }
    shape.counted = pass
    bytes -= more
    bodies--
  }
}
