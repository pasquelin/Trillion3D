// A vertex stage decodes the header of a quantized page in part (`pageHeaderFor`, corners
// and positions alone) unless its row draws a line or a cutout. The shipped decode of the part
// and of the whole runs in `shaderRun` over pages of every kind — plain, a line's, a cutout's,
// a deformed one's (skin and morph targets), positions shared by several vertices, one vertex —
// and each field it fills is compared word for word with a reference of the format written
// here, from the header's words and the format's stream order (`sdk-core/src/page/format.ts`), never from
// the shader. A read of the wrong word or a stream out of order moves a field, and the corners
// and positions decoded through the part differ from the JavaScript decoder's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PAGE_GEOMETRY_WGSL } from './pageGeometryWgsl.ts'
import { STRUCTS, integer$b, type Fn } from './triangleScene.fixture.ts'
import { decodeGeometryPage, residentGeometryPage } from '../../geometry/codec/geometryPage.ts'
import { encodePage } from '../../geometry/codec/encodePage.fixture.ts'
import { randomPage } from '../../geometry/codec/randomPages.fixture.ts'
import { reference, referenceUvSet, POINT, type Header } from './pageHeaderReference.fixture.ts'
import { FLAG_CLUSTER_PAGE } from '../types.ts'
import { MAX_UV_SETS } from '../../../../sdk-core/src/page/format.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgFloatRandom } from '../../../../math/src/sequence/seeded.fixture.ts'

/** `code` with every decimal literal the single-precision value it names: `shaderRun` computes in
 *  doubles, and a literal written with nine digits (`wgslF32`) is no `f32` until the processor
 *  rounds it — the hundredth of a centimetre that scales a position's cell (`clusterUnit`). */
const singleLiterals = (code: string) =>
  code.replace(/(?<![\w.])\d+\.\d+(?:e[+-]?\d+)?(?![\w.])/g, (text) =>
    String(Math.fround(Number(text))),
  )

/** The page geometry as a program holds it, its decode included. */
const PAGE_GEOMETRY = singleLiterals(wgslModule(PAGE_GEOMETRY_WGSL))

const random = lcgFloatRandom(831)
const floats = (n: number, at: (i: number) => number) =>
  Float32Array.from({ length: n }, (_, i) => at(i))

/** Pages of every kind the vertex stages meet, each at its own word of one pool, as the install pass
 *  writes it (`residentGeometryPage`); `page` is the page on disk it comes from. */
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
  const deformed = encodePage(
    indices,
    {
      ...{ POSITION, ...base },
      JOINTS_0: { itemSize: 4, array: floats(n * 4, (i) => (i * 3) % 5) },
      WEIGHTS_0: { itemSize: 4, array: floats(n * 4, () => 0.25) },
    },
    7,
    [0, 1, 2].map(() => ({
      POSITION: { itemSize: 3, array: floats(n * 3, () => random() - 0.5) },
      NORMAL: { itemSize: 3, array: floats(n * 3, () => random() - 0.5) },
    })),
  ).data
  const shared = encodePage([0, 1, 2, 2, 1, 3], {
    POSITION: { itemSize: 3, array: floats(12, (i) => [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0][i]) },
    TEXCOORD_0: { itemSize: 2, array: floats(8, (i) => i / 8) },
  }).data
  const lone = encodePage([0, 0, 0], {
    POSITION: { itemSize: 3, array: floats(3, () => 2) },
  }).data
  const plain = encodePage(indices, { POSITION }).data
  const masked = encodePage(indices, { POSITION, ...base }).data
  const lines = encodePage(indices, { POSITION, NORMAL: base.NORMAL }).data
  // Texture sets past the fourth: the ranges of the ones a page carries follow its morph records.
  const set = () => ({ itemSize: 2, array: floats(n * 2, random) })
  const sparse = encodePage(indices, {
    ...{ POSITION, TEXCOORD_0: set(), TEXCOORD_5: set(), TEXCOORD_7: set() },
  }).data
  const eight = encodePage(indices, {
    ...{ POSITION, NORMAL: base.NORMAL, TEXCOORD_0: set(), TEXCOORD_1: set(), TEXCOORD_2: set() },
    ...{ TEXCOORD_3: set(), TEXCOORD_4: set(), TEXCOORD_5: set(), TEXCOORD_6: set() },
    ...{ TEXCOORD_7: set() },
  }).data
  const kinds = { plain, lines, masked, deformed, shared, lone, sparse, eight }
  const larger = [3, 40, 250].map((v) => randomPage(random, v))
  larger.forEach((page, i) => Object.assign(kinds, { [`random${i}`]: page }))
  const words: number[] = [7, 7, 7]
  const placed = Object.entries(kinds).map(([name, data]) => {
    const page = data as Uint8Array
    const at = words.length
    const resident = residentGeometryPage(page)
    words.push(
      ...new Uint32Array(resident.buffer, resident.byteOffset, resident.byteLength / 4),
      0,
      0,
    )
    return { name, at, page }
  })
  return { words: Uint32Array.from(words), placed }
}

const NAMES = [
  ...'pageHeader pageHeaderFor pageCorner pageRestPosition vertPos'.split(' '),
  ...'clusterPointHeader clusterSurfaceHeader clusterWidths clusterUnit'.split(' '),
  ...'pow2FromExponent bitLength ceilDiv clusterIndex clusterBlock clusterWindow clusterField'.split(
    ' ',
  ),
  ...'clusterPosition clusterOffsets clusterUvSets clusterHasUv clusterUv clusterUvValue'.split(
    ' ',
  ),
  ...'clusterUvRange clusterUvFields clusterUvSet clusterUvAt'.split(' '),
]
const flat = (v: unknown): number[] =>
  typeof v === 'object' && v ? Object.values(v).flatMap(flat) : [Number(v)]
/** A WGSL array is zero where nothing wrote it; the interpreter's is empty (`shaderRunStructs`). */
const zeroed = (got: unknown, want: unknown) =>
  Array.isArray(got) && Array.isArray(want)
    ? Object.assign(new Array(want.length).fill(0), got)
    : got
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
      if (!same(zeroed(whole[key], want[key]), want[key])) return `${name}: whole header ${key}`
      if (POINT.includes(key) && !same(zeroed(part[key], want[key]), want[key]))
        return `${name}: part ${key}`
    }
    if (!same(run.pageHeader(row), whole)) return `${name}: pageHeader is not the whole`
    // What the stages do with the part: the corners and positions of the JavaScript decoder.
    const decoded = decodeGeometryPage(page)
    for (let c = 0; c < decoded.indices.length; c++)
      if (run.pageCorner(row, part, c) !== decoded.indices[c]) return `${name}: corner ${c}`
    // The ranges and stream offsets of every set, stored or not, as the format lays them out: a
    // page storing {0}, {0,5,7} or all eight (`shared`, `sparse`, `eight`) covers the extension.
    for (let s = 0; s < MAX_UV_SETS; s++) {
      const got = run.clusterUvSet(whole, at, s) as Record<string, number>
      const wantSet = referenceUvSet(words, at, s)
      for (const [field, value] of Object.entries(wantSet))
        if (got[field] !== value) return `${name}: set ${s} ${field}`
    }
    // Each texture set the page stores, the first four and those past them, as the JavaScript
    // decoder decodes it.
    for (let s = 0; s < MAX_UV_SETS; s++) {
      const coordinates = decoded.attributes[s ? `uv${s}` : 'uv']
      for (let v = 0; coordinates && v < decoded.vertexCount; v++) {
        const got = run.clusterUv(whole, at, v, s) as number[]
        if (!same(got, [coordinates[v * 2], coordinates[v * 2 + 1]])) return `${name}: uv${s} ${v}`
      }
    }
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
  return null
}

test('the part and the whole of a page header are the reference of the format', () => {
  assert.equal(firstDifference(PAGE_GEOMETRY), null)
})

// What the reference must catch: each edit moves one word the part or the whole reads.
const BREAKS: [string, string][] = [
  ['indices[base+19u]', 'indices[base+18u]'],
  ['indices[base+6u]', 'indices[base+7u]'],
  ['(dw>>6u)&255u', '(dw>>5u)&255u'],
  ['h.indexBits+5u', 'h.indexBits+4u'],
  ['h.influences=indices[base+22u]', 'h.influences=indices[base+21u]'],
  ['h.flags=indices[base+4u]', 'h.flags=indices[base+5u]'],
  ['(h.flags&1u)!=0u', '(h.flags&2u)!=0u'],
  ['h.normalBits=(cb>>16u)&15u', 'h.normalBits=(cb>>17u)&15u'],
  ['vec2u(indices[base+9u+2u*s],', 'vec2u(indices[base+10u+2u*s],'],
  ['return vec2u(indices[at],indices[at+1u]);', 'return vec2u(indices[at+1u],indices[at+1u]);'],
  ['countOneBits(below)', 'countOneBits(below>>1u)'],
  ['*countOneBits(h.flags&30720u)', '*countOneBits(h.flags&28672u)'],
  // The table of the streams' offsets: its place, the half of a word an offset lies in, the word
  // each stream is loaded from.
  ['let w=indices[base+table+k];', 'let w=indices[base+table+k+1u];'],
  ['return vec2u(w&0xffffu,w>>16u);', 'return vec2u(w>>16u,w&0xffffu);'],
  ['h.streams=h.table+15u;', 'h.streams=h.table+14u;'],
  ['h.normal=clusterOffsets(base,h.table,3u)', 'h.normal=clusterOffsets(base,h.table,2u)'],
  ['clusterOffsets(base,h.table,14u);h.tangent', 'clusterOffsets(base,h.table,13u);h.tangent'],
]
for (const [from, to] of BREAKS)
  test(`the reference catches ${from} read as ${to}`, () => {
    assert.ok(PAGE_GEOMETRY.includes(from), `${from} is in the shipped text`)
    assert.notEqual(firstDifference(PAGE_GEOMETRY.replace(from, to)), null)
  })
