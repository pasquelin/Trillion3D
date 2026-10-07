// S31: a page whose home ends where its bytes end is followed by its neighbour, or by nothing. The
// shipped decode (`../../cluster/decodeWgsl.ts`) runs each routine on every vertex, corner and
// triangle of a page followed by zeros, ones or noise: the values are the same, and the only word
// past the end ever read is the one a block record's two-word window loads and keeps none of.
import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterDecodeWgsl } from '../../cluster/decodeWgsl.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts'
import { decodeGeometryPage } from '../../page/codec/geometryPage.ts'
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts'
import { randomPage } from '../../page/codec/randomPages.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

type Fn = (...args: unknown[]) => unknown
const ROUTINES = ['clusterField', 'clusterWidths', 'clusterStep']
const READERS = ['clusterHeader', 'clusterTriangle', 'clusterIndex', 'clusterPosition', 'clusterUv']
const ATTRIBUTES = ['clusterNormal', 'clusterColor', 'clusterJoint', 'clusterWeight']
const NAMES = [...ROUTINES, ...READERS, ...ATTRIBUTES, 'clusterMorph']
const HELPERS = [
  'octDecodeScalar',
  'pow2FromExponent',
  'bitLength',
  'ceilDiv',
  'clusterStream',
  'clusterWindow',
  'clusterBlock',
  'clusterGrid',
].concat(['clusterPointHeader', 'clusterSurfaceHeader'])
/** WGSL's integers where the decode leans on them: it divides integers alone, and truncates;
 *  `i32` of a `u32` keeps its bits, `>>` of a negative `i32` is arithmetic. */
const INTEGERS = {
  i32: (x: number) => x | 0,
  countLeadingZeros: (x: number) => Math.clz32(x),
  $b: (op: string, a: number, b: number) =>
    typeof a !== 'number' || typeof b !== 'number'
      ? builtins.$b(op, a, b)
      : op === '/'
        ? Math.trunc(a / b)
        : op === '>>' && a < 0
          ? a >> b
          : builtins.$b(op, a, b),
}
/** Words before the page: its first word is never the pool's. */
const BASE = 3

/** The decode on a pool holding `page` at `BASE`, every word past its end `after(i)`, each read
 *  past it noted with the routine running then. */
function decoder(page: Uint8Array, after: (i: number) => number) {
  const words = new Uint32Array(page.buffer, page.byteOffset, page.byteLength / 4),
    end = BASE + words.length,
    past: string[] = []
  let running = ''
  const pool = new Proxy([], {
    get: (_, key) => {
      const i = Number(key)
      if (i < BASE) return 0x5eed
      if (i < end) return words[i - BASE]
      past.push(running)
      return after(i)
    },
  })
  const run = shaderRun<Record<string, Fn>>(
    wgslModule(clusterDecodeWgsl('pool')),
    [...NAMES, ...HELPERS],
    {
      pool,
      ...INTEGERS,
    },
  )
  const call = (name: string, ...args: unknown[]) => ((running = name), run[name](...args))
  return { call, past }
}

/** Every value each reader decodes from the page, by routine. */
function decodeAll(call: (name: string, ...args: unknown[]) => unknown) {
  const h = call('clusterHeader', BASE) as Record<string, number>
  const out: Record<string, unknown[]> = { clusterHeader: [h] }
  const add = (name: string, ...args: unknown[]) =>
    (out[name] ??= []).push(call(name, h, BASE, ...args))
  for (let tri = 0; tri < h.indexCount / 3; tri++) add('clusterTriangle', tri)
  for (let corner = 0; corner < h.indexCount; corner++) add('clusterIndex', corner)
  const skin = h.flags & 16 ? h.influences : 0
  for (let v = 0; v < h.vertexCount; v++) {
    add('clusterPosition', v)
    if (h.flags & 1) add('clusterNormal', v)
    if (h.flags & 2) add('clusterUv', v)
    if (h.flags & 8) add('clusterColor', v)
    for (let k = 0; k < skin; k++) {
      add('clusterJoint', v, k)
      add('clusterWeight', v, k)
    }
    for (let t = 0; t < h.morphCount; t++) {
      add('clusterMorph', t, v, false)
      add('clusterMorph', t, v, true)
    }
  }
  return out
}

let seed = 7
const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
const floats = (n: number, f: (i: number) => number) =>
  Float32Array.from({ length: n }, (_, i) => f(i))

/** The pages every stream of the format is read from. */
function pages() {
  const n = 9
  const position = floats(n * 3, (i) => (i % 7) * 0.5 - 1)
  const every = encodeGeometryPage(
    [0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 8, 1, 0],
    {
      POSITION: { itemSize: 3, array: position },
      NORMAL: { itemSize: 3, array: floats(n * 3, (i) => (i % 3 === 1 ? 1 : 0)) },
      TEXCOORD_0: { itemSize: 2, array: floats(n * 2, () => random()) },
      TEXCOORD_1: { itemSize: 2, array: floats(n * 2, () => random()) },
      COLOR_0: { itemSize: 4, array: floats(n * 4, () => random()) },
      JOINTS_0: { itemSize: 4, array: floats(n * 4, (i) => (i * 3) % 5) },
      WEIGHTS_0: { itemSize: 4, array: floats(n * 4, () => 0.25) },
    },
    -16,
    -14,
    [0, 1].map(() => ({
      POSITION: { itemSize: 3, array: floats(n * 3, () => random() - 0.5) },
      NORMAL: { itemSize: 3, array: floats(n * 3, () => random() - 0.5) },
    })),
  ).data
  // One position under two texture coordinates: the page stores it once and links to it.
  const linked = encodeGeometryPage([0, 1, 2, 2, 1, 3], {
    POSITION: { itemSize: 3, array: floats(12, (i) => [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0][i]) },
    TEXCOORD_0: { itemSize: 2, array: floats(8, (i) => i / 8) },
  }).data
  // One vertex: no corner bit, no position bit — the block table is the page's last word, and
  // a block record's window reaches one word past the end.
  const point = encodeGeometryPage([0, 0, 0], {
    POSITION: { itemSize: 3, array: floats(3, () => 2) },
  }).data
  const random3 = [3, 40, 300].map((v) => randomPage(random, v))
  return { every, linked, point, ...Object.fromEntries(random3.map((page, i) => [i, page])) }
}

test('a page decodes the same whatever follows its end; only a block window reads past it', () => {
  const readers = new Set<string>(),
    pastReaders = new Set<string>()
  for (const [name, page] of Object.entries(pages())) {
    const zero = decoder(page, () => 0),
      ones = decoder(page, () => 0xffffffff),
      noise = decoder(page, (i) => (i * 2654435761) >>> 0)
    const expected = decodeAll(zero.call)
    assert.deepEqual(decodeAll(ones.call), expected, name)
    assert.deepEqual(decodeAll(noise.call), expected, name)
    // The run decodes the page the JavaScript decoder decodes.
    const reference = decodeGeometryPage(page)
    const corners = (expected.clusterTriangle as number[][]).flat()
    assert.deepEqual(corners, [...reference.indices], name)
    assert.deepEqual(expected.clusterIndex, corners, name)
    const positions = (expected.clusterPosition as number[][]).flat().map(Math.fround)
    assert.deepEqual(positions, [...reference.attributes.position], name)
    for (const reader of Object.keys(expected)) readers.add(reader)
    for (const reader of [...zero.past, ...ones.past, ...noise.past]) pastReaders.add(reader)
    if (name === 'point') assert.ok(zero.past.length > 0, 'the one-vertex page reads past its end')
  }
  assert.deepEqual([...readers].sort(), [...READERS, ...ATTRIBUTES, 'clusterMorph'].sort())
  assert.deepEqual([...pastReaders].sort(), ['clusterIndex', 'clusterTriangle'])
})
