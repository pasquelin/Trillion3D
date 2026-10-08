// A tile's level is read once, by Range when the server serves it, and a level of the wrong length
// is refused where its read resolves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createTileSources } from './sources.ts'
import { createTileCounters } from './counters.ts'
import { tileLayout } from '../../texture/tiles.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import { createTextureLevelReader } from '../../texture/levelReader.ts'
import { tileRecord, tiledLevelBytes } from '../../texture/tileRecords.ts'

// Behaviour: a block level whose bytes are not the whole blocks its dimensions imply is refused
// where its read resolves — one failure, never held, never read again — and no tile of it takes
// a slot: placed, the tile would stay resident over the texels its slot held before.
test('a block level of the wrong length fails once, is never held, and takes no slot', async () => {
  const placed: unknown[] = []
  const failures: string[] = []
  const { device, textureWrites } = fakeDevice()
  const layout = tileLayout(256, 256)
  const tail = { levels: [], blocks: { bc7: [], astc: [], etc2: [] } }
  const read: string[] = []
  const atlas = {
    kind: 'color',
    textures: [
      { layout, lane: 'rgba', source: { kind: 'baked', sha256: 'a'.repeat(64), atlas: 0, tail } },
    ],
    roomFor: () => true,
    place: (key: unknown) => (placed.push(key), { x: 0, y: 0, layer: 0 }),
    poolOf: () => ({ texture: {} }),
  } as unknown as WebgpuTileAtlas
  const sources = createTileSources({
    device,
    readLevel: async ({ format }) => (read.push(format), new Uint8Array(1)),
    encoding: poolEncoding('bc7'),
    counters: createTileCounters(),
    onFailure: (phase, error) => failures.push(`${phase}: ${(error as Error).message}`),
  })
  const key = { slot: 0, level: 0, tx: 0, ty: 0 }
  const serve = (frame: number) => sources.serve(atlas, key, frame, () => ({}) as never)
  assert.equal(serve(1), 'waiting')
  await sources.settled()
  assert.equal(serve(2), 'waiting')
  await sources.settled()
  assert.deepEqual(failures, [
    `texture-level-read-failed ${'a'.repeat(64)}/0/0: TEXTURE_LEVEL_BYTES 256x256: 1`,
  ])
  assert.equal(sources.levels?.bytes, 0, 'the short level is not held')
  assert.deepEqual(placed, [])
  assert.deepEqual(textureWrites, [], 'nothing to write')
  assert.deepEqual(read, ['bc7'], "the level file of the texture's lane, read once")
})

// A block tile is one request of its record, by Range, written as the file holds
// it; a server that ignores Range sends the whole file once, and every tile of the level is cut
// from it with no second request. Until the first answer says which, one read goes alone: six
// tiles asked at once from a server that ignores Range would each download the whole file.
test('a block tile is read by its Range; a whole-file answer serves the whole level', async () => {
  globalThis.createImageBitmap ??= (() => Promise.reject(new Error('unused'))) as never
  const file = Uint8Array.from({ length: tiledLevelBytes(256, 256) }, (_, i) => (i * 13) & 255)
  const tail = { levels: [], blocks: { bc7: [], astc: [], etc2: [] } }
  const source = { kind: 'baked', sha256: 'c'.repeat(64), atlas: 0, tail }
  const atlas = {
    kind: 'color',
    textures: [{ layout: tileLayout(256, 256), lane: 'rgba', source }],
    roomFor: () => true,
    place: () => ({ x: 0, y: 0, layer: 0 }),
    poolOf: () => ({ texture: {} }),
  } as unknown as WebgpuTileAtlas
  const tiles = [0, 1, 2, 3].map((i) => ({ slot: 0, level: 0, tx: i & 1, ty: i >> 1 }))
  const records = tiles.map(({ tx, ty }) => tileRecord(256, 256, tx, ty))
  const run = async (ranges: boolean) => {
    const asked: (string | null)[] = []
    globalThis.fetch = (async (_: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range'),
        [from, to] = (range?.slice(6).split('-') ?? []).map(Number)
      asked.push(range)
      return ranges && range
        ? new Response(file.slice(from, to + 1), { status: 206 })
        : new Response(file, { status: 200 })
    }) as typeof fetch
    const { device } = fakeDevice()
    const written: Uint8Array[] = []
    device.queue.writeTexture = (_, data) => void written.push(data as Uint8Array)
    const readLevel = createTextureLevelReader(
      { textures: { url: '{sha}/{kind}-{level}.{format}', version: 6 }, key: 'k' },
      'https://host/',
    )
    const sources = createTileSources({
      device,
      readLevel,
      encoding: poolEncoding('bc7'),
      counters: createTileCounters(),
      onFailure: (_, error) => assert.fail(error as Error),
    })
    const pass = (frame: number, keys = tiles) =>
      keys.map((key) => sources.serve(atlas, key, frame, () => ({}) as never))
    // Four tiles asked at once: one read probes the server, the others wait for its answer.
    pass(1)
    assert.equal(asked.length, 1, 'one probe while Range support is unknown')
    await sources.settled()
    if (ranges) {
      pass(2, tiles.slice(1))
      await sources.settled()
    }
    assert.deepEqual(pass(3), ['served', 'served', 'served', 'served'])
    const slices = records.map(({ offset, bytes }) => file.subarray(offset, offset + bytes))
    assert.deepEqual(written, slices, 'each tile written from its record, a slice of the file')
    return asked
  }
  const ranges = records.map(({ offset, bytes }) => `bytes=${offset}-${offset + bytes - 1}`)
  assert.deepEqual(await run(true), ranges, 'one request per tile, its Range')
  assert.deepEqual(await run(false), [ranges[0]], 'the whole file, once, for the probe')
})
