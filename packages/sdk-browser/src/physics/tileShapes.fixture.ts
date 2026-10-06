import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { cooked, landed, tile } from './tiles.fixture.ts'

/** A model placing one two-byte tile, `t0.bin`, `count` times, ten metres apart along x from the
 *  origin: the `i`-th spans x `10 i` to `10 i + 2`. */
export const repeated = (count: number) =>
  cooked(
    [{ kind: 'mesh', tiles: [tile()] }],
    Array.from({ length: count }, (_, i) => ({
      ...{ node: i, collider: 0, position: [i * 10, 0, 0] },
      ...{ rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    })),
  )

/** What `writer` writes from now on: the handles it restores and releases, and the handle each
 *  body it adds is built on (`-1`: none). */
export function recorded(writer: CommandWriter) {
  const [restored, released, builtOn] = [[], [], []] as number[][]
  const restore = writer.restore.bind(writer),
    release = writer.release.bind(writer),
    add = writer.add.bind(writer)
  writer.restore = (handle, bytes) => (restored.push(handle), restore(handle, bytes))
  writer.release = (handle) => (released.push(handle), release(handle))
  writer.add = (record) => (builtOn.push(record.indices?.[0] ?? -1), add(record))
  return { restored, released, builtOn }
}

/** A streamer's updates at `eye` within `range`, each one's reads landed, until one neither adds
 *  a body nor asks a file: the bodies each added. */
export async function settle(
  streamer: {
    tiles: { update(eye: ArrayLike<number>, range: number): void }
    bodies: ReturnType<typeof createPhysicsBodies>
    fetched: string[]
  },
  eye: number[],
  range: number,
) {
  const { tiles, bodies, fetched } = streamer,
    added: number[] = []
  for (let round = 0; round < 100; round++) {
    const [held, asked] = [bodies.count.bodies, fetched.length]
    tiles.update(eye, range)
    await landed()
    added.push(bodies.count.bodies - held)
    if (bodies.count.bodies === held && fetched.length === asked) return added
  }
  throw new Error('the tiles never settle')
}

/** The least x of each resident tile's box, among the first `slots` body slots. */
export const residentAt = (bodies: ReturnType<typeof createPhysicsBodies>, slots: number) =>
  Array.from({ length: slots }, (_, i) => bodies.slots.at(i)).flatMap((owner) =>
    owner && 'tile' in owner ? [owner.tile.box[0]] : [],
  )
