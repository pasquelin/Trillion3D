// The runtime reads the world roots and pins their top alone; a placed cell holds the
// bundles past it that its objects' roots depend on, and lets them go when it leaves.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EngineError, type ClusterManifest } from '../../../sdk-core/src/index.ts'
import {
  worldRootsDag,
  worldRootsFixture,
} from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { encodeWorldRootsDag } from '../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { openWorldRoots } from './worldRoots.ts'
import { cellSuperRoots } from '../partition/superRoots.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** The fixture's world served over HTTP ranges, `bin` its binary as the server holds it, `dag` the
 *  world DAG its cook writes beside it; returns the manifest that declares its files, the ranges
 *  asked and the files read whole. */
function served(
  t: TestContext,
  bin?: Uint8Array,
  ignoresRange = false,
  dag?: Parameters<typeof encodeWorldRootsDag>[0],
) {
  const world = worldRootsFixture(sha)
  const records = { table: world.bytes, dag: dag && encodeWorldRootsDag(dag) }
  const held = bin ?? world.bin,
    ranges: string[] = [],
    whole: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const file = /\.(table|dag)$/.exec(input)?.[1] as 'table' | 'dag' | undefined
    if (file) return (whole.push(file), new Response(records[file]!.slice()))
    const range = (init?.headers as Record<string, string>).Range
    ranges.push(range)
    if (ignoresRange) return new Response(held.slice())
    const [from, to] = range.slice('bytes='.length).split('-').map(Number)
    return new Response(held.slice(from, to + 1), { status: 206 })
  })
  const announce = (bytes: Uint8Array) => ({ bytes: bytes.byteLength, sha256: sha(bytes) })
  const files = {
    'world-roots.table': announce(records.table),
    ...(records.dag && { 'world-roots.dag': announce(records.dag) }),
  }
  return { ...world, ranges, whole, manifest: { files } as unknown as ClusterManifest }
}

test('the pinned set is the world top alone; a placed cell holds its bundles past it', async (t) => {
  const { table, manifest, ranges } = served(t)
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  const top = table.pinnedTopBytes
  assert.deepEqual([roots.pinned.bundles, roots.pinned.bytes, roots.bytes()], [1, top, top])
  assert.deepEqual([...roots.pinned.pages[0].positions], [0, 0, 0, 1, 0, 0, 0, 1, 0])
  assert.deepEqual(ranges, [`bytes=0-${top - 1}`], 'the top alone, in one range')
  assert.deepEqual(roots.held(), [], 'no object root and no cell bundle is pinned')
  await Promise.all([roots.hold(0), roots.hold(1), roots.hold(2)])
  assert.deepEqual(roots.held(), [1, 2, 3], 'each bundle the placed cells need, read once')
  assert.equal(ranges.length, 4)
  roots.release(0)
  assert.deepEqual(roots.held(), [2, 3], 'a bundle another placed cell needs stays')
  roots.release(1)
  roots.release(2)
  assert.deepEqual([roots.held(), roots.bytes()], [[], top], 'the pinned top alone is left')
})

test('a bundle whose bytes are not those its table names is refused, and nothing held', async (t) => {
  const { bin } = worldRootsFixture()
  bin[bin.byteLength - 12] ^= 1 // the last bundle, a cell's
  const { manifest } = served(t, bin)
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  await assert.rejects(
    roots.hold(0),
    (error) => error instanceof EngineError && error.code === 'INVALID_CACHE',
  )
  assert.deepEqual(roots.held(), [], 'a hold that failed holds nothing')
})

test('a server that ignores the Range is read once, whole, and every byte counted', async (t) => {
  const { manifest, ranges, bin } = served(t, undefined, true)
  const metered: string[] = []
  const meter = {
    plan() {},
    settle() {},
    read: (response: Response, url: string) => (metered.push(url), response),
  }
  const roots = (await openWorldRoots(manifest, 'http://world/', undefined, meter))!
  await Promise.all([roots.hold(0), roots.hold(1), roots.hold(2)])
  assert.deepEqual(roots.held(), [1, 2, 3])
  assert.equal(ranges.length, 1, `the whole ${bin.byteLength}-byte binary, asked once`)
  assert.deepEqual(
    metered,
    ['http://world/world-roots.table', 'http://world/world-roots.bin'],
    'the binary read is counted as it arrives, as the table is',
  )
  const bundles = roots.held().reduce((sum, at) => sum + roots.table.bundles[at].bytes, 0)
  assert.equal(
    roots.bytes(),
    roots.pinned.bytes + bundles + bin.byteLength,
    'the whole binary kept is counted in the bytes held',
  )
})

test('the world DAG names its pages through the one source, from what is held', async (t) => {
  const { clusters, groups } = worldRootsDag()
  const { manifest, ranges, whole } = served(t, undefined, false, { clusters, groups })
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  assert.deepEqual(whole, ['table'], 'a load reads the table, never the DAG')
  const stream = await roots.stream()
  assert.deepEqual(whole, ['table', 'dag'], 'the DAG is read once its stream opens')
  assert.equal(stream, await roots.stream(), 'opened once')
  assert.deepEqual(whole, ['table', 'dag'], 'an opened stream reads its DAG no more')
  assert.equal(stream.dag!.pages.length, clusters.length, 'the cook\u2019s clusters, in rank')
  await roots.hold(0) // cell 0 holds bundles 1 and 3, the top is pinned
  const asked = ranges.length
  const addressed = stream.dag!.pages.filter((page) => page.url)
  const pages = await Promise.all(addressed.map((page) => stream.source.page(page.url)))
  assert.deepEqual(
    pages.map((page) => page.positions[0]),
    [1, 2, 3, 0],
    'each super-root reads the page at its bundle, the world top last',
  )
  assert.equal(ranges.length, asked + 1, 'only bundle 2, neither pinned nor held, is read')
  assert.deepEqual(roots.held(), [1, 3], 'a page read is not a cell hold')
  // A page owing its other WebGPU view keeps its bundle, and the CPU budget counts it.
  const before = roots.bytes(),
    far = addressed[1].url // bundle 2's super-root
  await stream.source.read(far)
  assert.equal(roots.bytes(), before + roots.table.bundles[2].bytes, 'the kept bundle is counted')
  await stream.source.attributes(far)
  assert.equal(roots.bytes(), before, 'both views served, it is let go')
})

test('a cache without its DAG file opens a stream with no DAG', async (t) => {
  const { manifest } = served(t)
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  const stream = await roots.stream()
  assert.deepEqual([stream.dag, stream.superRoots], [undefined, undefined])
})

test("the stream bounds each cell's super-roots, an object root in its object's cell", async (t) => {
  // The table lists one object in cell 0, two in cell 1, one in cell 2: an object root's `origin`
  // is its object's rank there, as the cook writes it.
  const { clusters, groups } = worldRootsDag()
  const cellOf = (origin: number) => Math.floor(origin / 4)
  const ranked = clusters.map((c) =>
    c.origin === null ? c : { ...c, origin: [0, 1, 3][cellOf(c.origin)] },
  )
  const { manifest } = served(t, undefined, false, { clusters: ranked, groups })
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  const { superRoots } = await roots.stream()
  assert.deepEqual(superRoots, cellSuperRoots(clusters, cellOf, 3))
})

test('a cache that publishes no world roots pins nothing', async () => {
  assert.equal(await openWorldRoots({} as ClusterManifest, 'http://world/'), undefined)
})
