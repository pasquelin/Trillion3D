// What the deformation-kernel proof lays out (`deformation-kernel.gpu.ts`): a compressed page that
// is skinned and morphed, the records of every source the stage reads, and the frames that switch
// between them. Every page-table word is named by the field `PageInfo` declares
// (`PAGE_INFO_STRUCT_WGSL`), never by a copied offset; each record is laid out by `recordLayout`.
import { Waves } from '../../../packages/sdk-core/src/fluids/waves.ts'
import { encodeGeometryPage } from '../../../packages/page-codec/src/geometryPage.ts'
import { FLAG_SKIN, FLAG_SOFT_SOURCE } from '../../../packages/sdk-browser/src/cluster/format.ts'
import {
  KIND_MORPH,
  KIND_SKIN,
  KIND_SOFT,
  KIND_WAVE,
  RECORD_HEAD,
  recordLayout,
} from '../../../packages/sdk-browser/src/deformation/layout.ts'
import { DEFORM_VERTEX_WORDS } from '../../../packages/sdk-browser/src/deformation/slotLayout.ts'
import {
  DEFORM_IN_POOL,
  FLAG_CLUSTER_PAGE,
  FLAG_DYNAMIC,
} from '../../../packages/sdk-browser/src/visibility/types.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/pageWgsl.ts'
import { wgslStructLayout } from '../../../packages/sdk-browser/src/vsm/wgslStructLayout.fixture.ts'

/** A buffer of the stage, by its shader name. */
export type BufferName = 'indices' | 'positions' | 'pages'
/** Words written into a buffer from word `at`, before a frame's dispatch. */
type Write = { buffer: BufferName; at: number; words: number[] }
/** One frame: its writes, and where its three vertex records are read back. */
export type Frame = { writes: Write[]; read: { buffer: BufferName; at: number } }

const ROW = wgslStructLayout(PAGE_INFO_STRUCT_WGSL, 'PageInfo')
/** A page-table row whose named fields take `fields`, every other word zero. */
const row = (fields: Record<string, number>) => {
  const words = new Array<number>(ROW.size / 4).fill(0)
  for (const [name, value] of Object.entries(fields)) {
    if (!(name in ROW.offsets)) throw new Error(`PageInfo has no field ${name}`)
    words[ROW.offsets[name] / 4] = value >>> 0
  }
  return words
}
/** The words of `floats`, bit for bit. */
const bits = (floats: Float32Array) => [
  ...new Uint32Array(floats.buffer, floats.byteOffset, floats.length),
]

export const REST = [0, 0, 0, 1, 0, 0, 0, 1, 0],
  MOVED = REST.map((c, i) => (i % 3 === 2 ? 2 : c))
const page = encodeGeometryPage(
  [0, 1, 2],
  {
    POSITION: { array: REST, itemSize: 3 },
    NORMAL: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1], itemSize: 3 },
    JOINTS_0: { array: new Uint32Array(12), itemSize: 4 },
    WEIGHTS_0: { array: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], itemSize: 4 },
  },
  -16,
  -14,
  [{ POSITION: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1], itemSize: 3 } }],
)
/** The page's slot in the cache, and its vertices' records just after it, past two tag words. */
const SLOT = 17,
  OUTPUT = SLOT + page.data.length / 4 + 2
const pool = new Array<number>(OUTPUT + 3 * DEFORM_VERTEX_WORDS).fill(0)
pool.splice(SLOT, page.data.length / 4, ...new Uint32Array(page.data.buffer, page.data.byteOffset))

/** The skin and morph record: one joint moving +2 along x, one target at full weight. */
const skinned = recordLayout({ joints: 1, targets: 1, waves: 0 })
const record = new Float32Array(160)
new Uint32Array(record.buffer).set([KIND_MORPH | KIND_SKIN, KIND_MORPH | KIND_SKIN, 1, 1])
record.set([1, 0, 0, 2, 0, 1, 0, 0, 0, 0, 1, 0], skinned.palette)
record.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], skinned.palette + 12)
record.set([1, 0], skinned.weights)

const clusterRow = {
  flags: FLAG_CLUSTER_PAGE,
  pageOffset: SLOT,
  indexCount: 3,
  deformCount: 3,
  deform: 1,
  deformOutput: OUTPUT + 1,
}
/** A soft source: two vertices simulated three and two metres along z. */
const soft = new Float32Array(160)
new Uint32Array(soft.buffer).set([KIND_SOFT, KIND_SOFT, 0, 0, 0, 1, 1, 0])
soft.set([0, 0, 3, 0, 0, 2, 0, 0, 0, 0, 0, 1], RECORD_HEAD)
/** One wave, read through identity world matrices. */
export const waves = new Waves([
  { direction: [1, 0.3], wavelength: 3, amplitude: 0.2, steepness: 0.3 },
])
waves.setTime(0.5)
const waved = recordLayout({ joints: 0, targets: 0, waves: 1 })
const wave = new Float32Array(160)
new Uint32Array(wave.buffer).set([KIND_WAVE, KIND_WAVE, 0, 0, 1, 0, 0, 0])
for (let at = waved.world; at < waved.wave; at += 16)
  wave.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], at)
const [dirX, dirZ, k, amplitude, lateral, phase] = [
  waves.dirX,
  waves.dirZ,
  waves.k,
  waves.amplitude,
  waves.lateral,
  waves.phase,
].map((values) => values[0])
wave.set([dirX, dirZ, k, amplitude, lateral, phase, phase, 0], waved.wave)
wave.set([dirX, dirZ, k, amplitude, lateral, phase, phase, 0], waved.wave + 8)
/** A whole copy in the float pool: the rest vertices, the skin record at 16, the source header
 *  just before the block (`packedBase - 1`: flags, morphs, vertices, floats a vertex), then each
 *  vertex's morph delta and four influences; its records are written at float 100. */
const MORPHS = 1,
  INFLUENCES = 4,
  SOURCE_FLOATS = MORPHS * 6 + INFLUENCES * 2,
  HEADER = 52,
  WHOLE_OUTPUT = 100
const whole = new Float32Array(160)
whole.set(REST)
new Uint32Array(whole.buffer).set(new Uint32Array(record.buffer, 0, skinned.floats), 16)
whole.set([FLAG_SKIN, MORPHS, 3, SOURCE_FLOATS], HEADER)
for (let v = 0; v < 3; v++)
  whole.set([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0], HEADER + 4 + v * SOURCE_FLOATS)

const atOutput = { buffer: 'indices', at: OUTPUT } as const
export const FRAMES: Frame[] = [
  { writes: [], read: atOutput },
  // A dynamic float source at rest: its previous position is its rest one.
  {
    writes: [
      {
        buffer: 'pages',
        at: 0,
        words: row({ ...clusterRow, flags: FLAG_DYNAMIC, deform: 0, selectionIndex: 1 }),
      },
      { buffer: 'positions', at: 0, words: bits(new Float32Array(REST)) },
    ],
    read: atOutput,
  },
  // Moved two metres along z: the previous position is the last image's.
  {
    writes: [{ buffer: 'positions', at: 0, words: bits(new Float32Array(MOVED)) }],
    read: atOutput,
  },
  { writes: [], read: atOutput },
  // The compressed page again, as a soft source.
  {
    writes: [
      { buffer: 'pages', at: 0, words: row(clusterRow) },
      { buffer: 'indices', at: SLOT + 4, words: [pool[SLOT + 4] | FLAG_SOFT_SOURCE] },
      { buffer: 'positions', at: 0, words: bits(soft) },
    ],
    read: atOutput,
  },
  { writes: [{ buffer: 'positions', at: 0, words: bits(wave) }], read: atOutput },
  // The whole copy: the rest vertices skinned out of the float pool, written into it.
  {
    writes: [
      {
        buffer: 'pages',
        at: 0,
        words: row({
          ...clusterRow,
          flags: 0,
          packedBase: HEADER + 1,
          deform: 17,
          deformOutput: (WHOLE_OUTPUT + 1) | DEFORM_IN_POOL,
        }),
      },
      { buffer: 'positions', at: 0, words: bits(whole) },
    ],
    read: { buffer: 'positions', at: WHOLE_OUTPUT },
  },
]

/** The buffers before the first frame: the cache with the page, the skin record, the float pool's
 *  normals (seven floats a vertex: the normal, then a tangent), and the page's row. */
export const BUFFERS = {
  indices: pool,
  positions: bits(record),
  normals: [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  pages: row(clusterRow),
}
