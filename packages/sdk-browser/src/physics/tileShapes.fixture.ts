import type {
  CommandWriter,
  CookedBody,
  CookedSoftBody,
} from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { cooked, declared, landed, modelStreamer, place, stubFetch, tile } from './tiles.fixture.ts'

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

/** A model's `physics.json`: one tile of `tile.bin`, two bytes, placed at the origin, and kinematic
 *  bodies on nodes 1 to `count`, 3 m apart from x = 3, each built on the hull `url` of `bytes`. */
export function hulled(count: number, url: string, bytes: number) {
  const hull = { type: 'cooked', url, sha256: 'h'.repeat(64), bytes }
  const crates = Array.from({ length: count }, (_, i) =>
    declared(i + 1, [i * 3 + 3, 0, 0], { isKinematic: true }, hull),
  )
  const file = cooked([{ kind: 'mesh', tiles: [{ ...tile(), url: 'tile.bin' }] }], [place(0)])
  return { file: { ...file, bodies: crates }, crates }
}

/** A cloth of nine vertices on node `node`, `node` × 3 m along x, made from `settings`. */
export const cloth = (node: number, settings: CookedSoftBody['settings']): CookedSoftBody => ({
  ...{ node, position: [node * 3, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  ...{ physics: { type: 'cloth', pins: [0] }, vertices: 9, pressure: 0 },
  ...{ friction: 0.5, restitution: 0, settings },
})

/** `file` opened by a streamer within `budget`, its `crates` numbered, every file `bytes`, and
 *  settled around the origin: the streamer, what its writer writes, and the files it asked. */
export async function opened(
  file: object,
  crates: CookedBody[],
  budget = {},
  bytes = new Uint8Array(4),
) {
  const fetched = stubFetch(file, bytes)
  const streamer = modelStreamer(budget, 1, crates)
  const written = recorded(streamer.writer)
  streamer.tiles.scan(streamer.scene)
  await landed()
  await settle({ ...streamer, fetched }, [0, 0, 0], 100)
  return { ...streamer, ...written, fetched }
}
