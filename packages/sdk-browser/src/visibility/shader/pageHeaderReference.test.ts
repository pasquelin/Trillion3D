// #831: a vertex stage decodes the header of a quantized page in part (`pageHeaderFor`, corners
// and positions alone) unless its row draws a line or a cutout. The shipped decode of the part
// and of the whole runs in `shaderRun` over pages of every kind — plain, a line's, a cutout's,
// a deformed one's (skin and morph targets), positions shared by several vertices, one vertex —
// and each field it fills is compared word for word with a reference of the format written
// here, from the header's words and the format's stream order (`cluster/format.ts`), never from
// the shader. A read of the wrong word or a stream out of order moves a field, and the corners
// and positions decoded through the part differ from the JavaScript decoder's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { PAGE_GEOMETRY_WGSL } from './pageGeometryWgsl.ts'
import { STRUCTS, integer$b, type Fn } from './triangleScene.fixture.ts'
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts'
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts'
import { randomPage } from '../../page/decode/randomPages.fixture.ts'
import { reference, POINT, type Header } from './pageHeaderReference.fixture.ts'
import { DEFORM_IN_POOL, FLAG_CLUSTER_PAGE } from '../types.ts'

let seed = 831
const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
const floats = (n: number, at: (i: number) => number) =>
  Float32Array.from({ length: n }, (_, i) => at(i))

/** Pages of every kind the vertex stages meet, each at its own word of one pool. */
function pool() {
  const n = 9
  const position = floats(n * 3, (i) => (i % 7) * 0.5 - 1 + random() * 1e-3)
  const base = {
    NORMAL: { itemSize: 3, array: floats(n * 3, () => random() * 2 - 1) },
    TEXCOORD_0: { itemSize: 2, array: floats(n * 2, random) },
    COLOR_0: { itemSize: 4, array: floats(n * 4, random) },
  }
  const indices = [0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 8, 1, 0]
  const POSITION = { itemSize: 3, array: position }
  const deformed = encodeGeometryPage(
    indices,
    {
      ...{ POSITION, ...base },
      JOINTS_0: { itemSize: 4, array: floats(n * 4, (i) => (i * 3) % 5) },
      WEIGHTS_0: { itemSize: 4, array: floats(n * 4, () => 0.25) },
    },
    -16,
    -14,
    [0, 1, 2].map(() => ({
      POSITION: { itemSize: 3, array: floats(n * 3, () => random() - 0.5) },
      NORMAL: { itemSize: 3, array: floats(n * 3, () => random() - 0.5) },
    })),
  ).data
  const shared = encodeGeometryPage([0, 1, 2, 2, 1, 3], {
    POSITION: { itemSize: 3, array: floats(12, (i) => [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0][i]) },
    TEXCOORD_0: { itemSize: 2, array: floats(8, (i) => i / 8) },
  }).data
  const lone = encodeGeometryPage([0, 0, 0], {
    POSITION: { itemSize: 3, array: floats(3, () => 2) },
  }).data
  const plain = encodeGeometryPage(indices, { POSITION }).data
  const masked = encodeGeometryPage(indices, { POSITION, ...base }).data
  const lines = encodeGeometryPage(indices, { POSITION, NORMAL: base.NORMAL }).data
  const kinds = { plain, lines, masked, deformed, shared, lone }
  const larger = [3, 40, 300].map((v) => randomPage(random, v))
  larger.forEach((page, i) => Object.assign(kinds, { [`random${i}`]: page }))
  const words: number[] = [7, 7, 7]
  const placed = Object.entries(kinds).map(([name, data]) => {
    const page = data as Uint8Array
    const at = words.length
    words.push(...new Uint32Array(page.buffer, page.byteOffset, page.byteLength / 4), 0, 0)
    return { name, at, page }
  })
  return { words: Uint32Array.from(words), placed }
}

const NAMES = [
  ...'pageHeader pageHeaderFor deformWholeCopy pageCorner pageRestPosition vertPos'.split(' '),
  ...'clusterPointHeader clusterSurfaceHeader clusterStream clusterWidths clusterStep'.split(' '),
  ...'clusterPow2 clusterBitsFor clusterIndex clusterBlock clusterWindow clusterField'.split(' '),
  ...'clusterPosition clusterGrid'.split(' '),
]
const flat = (v: unknown): number[] =>
  typeof v === 'object' && v ? Object.values(v).flatMap(flat) : [Number(v)]
const same = (got: unknown, want: unknown) =>
  flat(got).length === flat(want).length &&
  flat(got).every((x, i) => Object.is(Math.fround(x), Math.fround(flat(want)[i])))

/** The first difference between the shipped decode of `code` and the reference, or null. */
function firstDifference(code: string): string | null {
  const { words, placed } = pool()
  const run = shaderRun<Record<string, Fn>>(code, NAMES, {
    ...STRUCTS,
    $b: integer$b,
    indices: Array.from(words),
    positions: [],
    uvs: [],
  })
  for (const { name, at, page } of placed) {
    const row = { pageOffset: at, flags: FLAG_CLUSTER_PAGE, deformOutput: 0, lineWidth: 0 }
    const want = reference(words, at)
    const part = run.pageHeaderFor(row, false) as Header
    const whole = run.pageHeaderFor(row, true) as Header
    for (const key of Object.keys(want)) {
      if (!same(whole[key], want[key])) return `${name}: whole header ${key}`
      if (POINT.includes(key) && !same(part[key], want[key])) return `${name}: part ${key}`
    }
    if (!same(run.pageHeader(row), whole)) return `${name}: pageHeader is not the whole`
    // What the stages do with the part: the corners and positions of the JavaScript decoder.
    const decoded = decodeGeometryPage(page)
    for (let c = 0; c < decoded.indices.length; c++)
      if (run.pageCorner(row, part, c) !== decoded.indices[c]) return `${name}: corner ${c}`
    for (let v = 0; v < decoded.vertexCount; v++)
      for (let k = 0; k < 3; k++)
        if (
          !same(
            (run.pageRestPosition(row, part, v) as number[])[k],
            decoded.attributes.position[v * 3 + k],
          )
        )
          return `${name}: position ${v}`
  }
  // A float page deformed whole in the pool: its skin and morph counts come from its tail.
  const tail = { flags: 16, morphCount: 2, influences: 5 }
  const float = shaderRun<Record<string, Fn>>(code, NAMES, {
    ...STRUCTS,
    $b: integer$b,
    indices: [],
    uvs: [],
    positions: [tail.flags, tail.morphCount, 0, 2 * 6 + tail.influences * 2],
  })
  const row = { pageOffset: 0, flags: 0, packedBase: 1, deformOutput: (DEFORM_IN_POOL | 1) >>> 0 }
  const h = float.pageHeaderFor(row, false) as Header
  return Object.keys(tail).every((k) => h[k] === tail[k as keyof typeof tail])
    ? null
    : 'float page tail'
}

test('the part and the whole of a page header are the reference of the format', () => {
  assert.equal(firstDifference(PAGE_GEOMETRY_WGSL), null)
})

// What the reference must catch: each edit moves one word the part or the whole reads.
const BREAKS: [string, string][] = [
  ['indices[base+21u]', 'indices[base+20u]'],
  ['indices[base+6u]', 'indices[base+7u]'],
  ['(dw>>6u)&255u', '(dw>>5u)&255u'],
  ['h.indexBits+5u', 'h.indexBits+4u'],
  ['h.influences=indices[base+24u]', 'h.influences=indices[base+23u]'],
  ['h.flags=indices[base+4u]', 'h.flags=indices[base+5u]'],
  ['(h.flags&2u)!=0u', '(h.flags&4u)!=0u'],
  ['positions[at+1u]', 'positions[at+2u]'],
]
for (const [from, to] of BREAKS)
  test(`the reference catches ${from} read as ${to}`, () => {
    assert.ok(PAGE_GEOMETRY_WGSL.includes(from), `${from} is in the shipped text`)
    assert.notEqual(firstDifference(PAGE_GEOMETRY_WGSL.replace(from, to)), null)
  })
