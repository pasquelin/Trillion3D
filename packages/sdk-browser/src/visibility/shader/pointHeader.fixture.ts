// The scene the tests of the shipped stages run over: quantized pages of 1 to 128 triangles
// under every row kind, a source-buffer page, far from the origin; `stages` runs a shipped text
// over it.
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts'
import { STRUCTS, integer$b, type Fn } from './triangleScene.fixture.ts'
import * as F from '../types.ts'
import { NO_HIZ_SLOT } from '../../webgpu/row/noHizSlot.ts'
import { perspectiveProjection } from '../../../../sdk-core/src/index.ts'
import type { Vec } from '../../texture/shaderRun.fixture.ts'

let seed = 831
const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
const floats = (n: number, at: () => number) => Float32Array.from({ length: n }, at)

/** A quantized page of `triangles` triangles over `vertices` vertices, its attributes `full` or
 *  positions alone; `shared` repeats each position on a second vertex, so the page links them. */
function encoded(triangles: number, vertices: number, full: boolean, shared: boolean) {
  const position = floats(vertices * 3, () => random() * 4 - 2)
  if (shared) for (let v = 1; v < vertices; v += 2) position.copyWithin(v * 3, v * 3 - 3, v * 3)
  const indices = Array.from({ length: triangles * 3 }, (_, i) =>
    i < vertices ? i : Math.floor(random() * vertices),
  )
  const attributes = full
    ? {
        NORMAL: { itemSize: 3, array: floats(vertices * 3, () => random() * 2 - 1) },
        TEXCOORD_0: { itemSize: 2, array: floats(vertices * 2, random) },
        COLOR_0: { itemSize: 4, array: floats(vertices * 4, random) },
      }
    : {}
  const POSITION = { itemSize: 3, array: position }
  const data = encodeGeometryPage(indices, { POSITION, ...attributes }).data as Uint8Array
  return new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4)
}

/** Far from the origin: the world puts every page a hundred kilometres out. */
const FAR = new Mat([1.5, 0, 0.2, 0, 0, 0.8, 0, 0, 0, 0.3, 1.2, 0, 1e5, -2e4, 3e4, 1])
const MIRROR = new Mat([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1e5, -2e4, 3e4, 1])
/** Each row's surface reads: none, a UV, a cutout, a cutout with UVs, a coloured one, a line. */
export const ROWS: [number, number][] = [
  [0, 0],
  [F.FLAG_HAS_UV, 0],
  [F.FLAG_MASK, 0],
  [F.FLAG_HAS_UV | F.FLAG_MASK | F.FLAG_HAS_MAP, 0],
  [F.FLAG_HAS_UV | F.FLAG_MASK | F.FLAG_HAS_COLOR, 0],
  [F.FLAG_DOUBLE, 2],
  [F.FLAG_BACK, 0],
]

/** The pool and the page table: every page under every row kind, and a source-buffer page. */
function scene() {
  const words: number[] = [7, 7, 7]
  const pages: Record<string, unknown>[] = []
  const SIZES = [1, 3, 12, 8, 32, 24, 128, 70]
  for (let size = 0; size < SIZES.length; size += 2)
    for (const full of [false, true])
      for (const shared of [false, true]) {
        const [at, triangles] = [words.length, SIZES[size]]
        words.push(...encoded(triangles, SIZES[size + 1], full, shared), 0, 0)
        for (const [flags, lineWidth] of ROWS)
          pages.push({
            ...{ world: pages.length % 3 ? FAR : MIRROR, sprite: [0, 0], lineWidth },
            ...{ flags: flags | F.FLAG_CLUSTER_PAGE, pageOffset: at, indexCount: triangles * 3 },
            ...{ vertexBase: 0, packedBase: pages.length << 8, deformOutput: 0 },
            hizSlot: NO_HIZ_SLOT,
          })
      }
  const offset = words.length
  words.push(...Array.from({ length: 36 }, () => Math.floor(random() * 8)))
  const pool = Array.from(floats(24, () => random() * 4 - 2))
  pages.push({
    ...{ world: FAR, sprite: [0, 0], lineWidth: 0, flags: F.FLAG_HAS_UV | F.FLAG_MASK },
    ...{ pageOffset: offset, indexCount: 36, vertexBase: 0, packedBase: 0, deformOutput: 0 },
    hizSlot: NO_HIZ_SLOT,
  })
  return { words, pages, pool, uvs: Array.from(floats(64, random)) }
}

const DECODE = [
  'pageHeader pageHeaderFor pageSurfaceRead deformWholeCopy pageCorner pageTriangle pagePosition',
  'pageRestPosition pageUv pageMaskAlpha pageColor vertPos vertUv clusterPointHeader',
  'clusterSurfaceHeader clusterStream clusterWidths clusterStep clusterPow2 clusterBitsFor',
  'clusterIndex clusterTriangle clusterBlock clusterWindow clusterField clusterPosition clusterGrid',
  'clusterUv clusterNormal clusterColor octDecodeScalar',
].flatMap((line) => line.split(' '))
/** Column-major 4×4 product, which `shaderRun`'s operators leave to the scope. */
const product = (a: readonly number[], b: readonly number[]) =>
  Array.from({ length: 16 }, (_, i) =>
    [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + (i % 4)] * b[(i & ~3) + k], 0),
  )
const BASE_SCOPE = {
  ...STRUCTS,
  $b: (op: string, a: unknown, b: unknown) =>
    a instanceof Mat && b instanceof Mat
      ? new Mat(product(a.m, b.m))
      : integer$b(op, a as number, b as number),
}
/** The camera the runs of the scene look through, eight metres before the pages and as far out:
 *  `zoom` 1 frames them; the corner comparisons zoom in until their triangles are large. */
export const cameraViewProj = (zoom: number) =>
  new Mat(
    product(
      [...perspectiveProjection(new Float64Array(16), 60, 1.5, 0.1, zoom)],
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1e5, 2e4, -3e4 - 8, 1],
    ),
  )
/** The camera vertex stages and what they call beside the decode, and the scope they read. */
export const VIS_VS_NAMES = ['vis_vs', 'vis_hiz_vs', 'drawBatch', 'instanceRow'].concat(
  ['instanceCorner', 'hardwareIdle', 'hardwareCorner', 'pageClip', 'computeTakes', 'screen'],
  ['clipToPixel'],
  ['screenBox', 'boxOf', 'pageLine', 'lineClip'],
)
export const VIS_VS_SCOPE = {
  ...{ HARDWARE_SKIP: 0xffffffff, pageSprite: () => [0, 0, 0, 1] },
  ScreenBox: (lo: Vec, hi: Vec, q0: Vec, q1: Vec, span: number) => ({ lo, hi, q0, q1, span }),
}
const { words, pages, pool, uvs } = scene()
export { pages }
const GEOMETRY = { indices: words, positions: pool, uvs, pages, vertColor: () => [1, 1, 1, 0.5] }

/** The shipped `names` of `code` over the scene. */
export const stages = (code: string, names: string[], scope: object) =>
  shaderRun<Record<string, Fn>>(code, names.concat(DECODE), {
    ...{ ...BASE_SCOPE, ...wgslConstants(code), ...GEOMETRY, ...scope },
  })
