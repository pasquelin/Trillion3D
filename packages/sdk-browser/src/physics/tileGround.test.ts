import test from 'node:test'
import assert from 'node:assert/strict'
import { castDown, startModule } from './module.fixture.ts'
import { cooked, fixture, landed, modelStreamer, place, stubFetch } from './tiles.fixture.ts'

type Kind = 'heightField' | 'mesh'
/** The cook's golden tile of each kind and its box: a 5 × 5 height field over x and z from 0 to
 *  2, rising as x z; a 2 × 2 m ramp rising from 0 to 1 along x. */
const GOLDEN = { heightField: 'height-field-tile.bin', mesh: 'ramp-tile.bin' }
const BOUNDS = { heightField: [0, 0, 0, 2, 1.6, 2], mesh: [0, 0, -1, 2, 1, 1] }

/** A model placing one tile of each of `kinds` once, the `i`-th `10 i` metres along x, opened by a
 *  tile streamer beside a started module: the streamer and the module. */
async function grounded(kinds: Kind[]) {
  const files = new Map<string, Uint8Array>()
  const colliders = await Promise.all(
    kinds.map(async (kind, i) => {
      const bytes = new Uint8Array(await fixture(GOLDEN[kind]))
      files.set(`${kind}${i}.bin`, bytes)
      const tile = { url: `${kind}${i}.bin`, sha256: 'a'.repeat(64), bytes: bytes.length }
      return { kind, tiles: [{ ...tile, triangles: 2, bounds: BOUNDS[kind] }] }
    }),
  )
  const file = cooked(
    colliders,
    kinds.map((_, i) => place(i)),
  )
  // Each tile its golden bytes.
  stubFetch(file, new Uint8Array(0), (name) => {
    const bytes = files.get(name)
    return bytes && new Response(bytes.slice())
  })
  const streamer = modelStreamer({ bodies: 16 })
  streamer.tiles.scan(streamer.scene)
  await landed()
  return { ...streamer, jolt: await startModule() }
}

/** The height a ray straight down at `x` meets, once the one update asked and its tiles landed —
 *  no update after, as a page at rest draws none —, or `null`. */
async function groundAt(kinds: Kind[], xs: number[]) {
  const { tiles, writer, jolt, errors } = await grounded(kinds)
  tiles.update([1, 5, 0], 100)
  await landed()
  jolt.step(writer.take(), 0)
  assert.deepEqual(errors, [])
  return xs.map((x) => {
    const hit = castDown(jolt, x)
    return hit[0] === 0xffffffff ? null : Math.round(new Float32Array(hit.buffer)[3] * 100) / 100
  })
}

test('a height field tile under the eye has its body once its bytes land, and a ray down meets it', async () => {
  assert.deepEqual(await groundAt(['heightField'], [1]), [0])
})

test('a mesh tile under the eye has its body once its bytes land, and a ray down meets it', async () => {
  assert.deepEqual(await groundAt(['mesh'], [1]), [0.5])
})

test('a model of both kinds has both bodies once their bytes land, each met by a ray down', async () => {
  assert.deepEqual(await groundAt(['heightField', 'mesh'], [1, 11]), [0, 0.5])
})
