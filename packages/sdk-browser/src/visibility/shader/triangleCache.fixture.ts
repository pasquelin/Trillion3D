// A frame of the resolve's triangle cache in `shaderRun` (`shadeCacheWgsl.ts`) on the rows and
// image of `triangleScene.fixture.ts`: the shipped marks, rows and triangles passes — `none`, no
// pass and `SHADE_CACHE` false —, then the shipped `pixelTriangle` and
// `decodeTriangle`. The page decode runs on integers, its results in
// binary32; the rest of the decode in binary32 (`F32_SCOPE`); the cache passes on words.
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { F32_SCOPE } from '../../lighting/shaderRunF32.fixture.ts'
import { perspectiveProjection } from '../../../../sdk-core/src/index.ts'
import { SHADE_CACHE_SHADER, SHADE_TRIS_SHADER, shadeCacheReadWgsl } from './shadeCacheWgsl.ts'
import {
  Mat3,
  STRUCTS,
  f,
  image,
  integer$b,
  scene,
  times,
  type Fn,
  type V,
} from './triangleScene.fixture.ts'

/** The shipped passes and reads on `scene()`, sharing one array of cache words. */
export function cacheRun(width: number, height: number, none = false) {
  const { pages, words, pool, normals, uvs } = scene()
  const projection = perspectiveProjection(new Float64Array(16), 60, width / height, 0.1, 50)
  const uni = {
    viewProj: new Mat([...projection].map(f)),
    viewport: [width, height],
    pixelRatio: 1,
  }
  const decode = shaderRun<Record<string, Fn>>(
    SHADE_TRIS_SHADER,
    'pageHeader pageHeaderFor deformWholeCopy pageTriangle pagePosition pageRestPosition pageDeformed pageUv pageNormal vertPos vertUv vertN clusterPointHeader clusterSurfaceHeader clusterTriangle clusterBlock clusterWindow clusterField clusterWidths clusterStep pow2FromExponent bitLength ceilDiv clusterStream clusterPosition clusterGrid clusterUv clusterNormal octDecodeScalar'.split(
      ' ',
    ),
    {
      ...STRUCTS,
      $b: integer$b,
      indices: words,
      positions: pool,
      uvs,
      normalAt: (i: number) => normals[i],
    },
  )
  const rounded =
    (name: string) =>
    (...args: unknown[]) => {
      const out = decode[name](...args)
      return Array.isArray(out) ? out.map(f) : out
    }
  const geometry = Object.fromEntries(
    ['pageHeader', 'pageTriangle', 'pagePosition', 'pageUv', 'pageNormal'].map((name) => [
      name,
      rounded(name),
    ]),
  )
  const exact = shaderRun<Record<string, Fn>>(
    SHADE_TRIS_SHADER,
    [
      'decodeTriangle',
      'transformedNormals',
      'framebuffer',
      'clipToFramebuffer',
      'invTranspose3Apply',
      'uniteOuZero',
      'pageSprite',
      'spriteAt',
      'composeRowFrame',
      'invTranspose3Prep',
      'worldMatrix3',
      'windingKept',
    ],
    {
      ...F32_SCOPE,
      ...STRUCTS,
      ...geometry,
      uni,
      $b: (op: string, a: unknown, b: unknown) =>
        a instanceof Mat3 ? times(a, b as V) : F32_SCOPE.$b(op, a as V, b as V),
    },
  )
  const cache: number[] = []
  const work: number[] = []
  const tileIds: number[] = []
  let atBarrier = false
  const STOP = {}
  const vis = image(width, height, pages.length)
  const scope = {
    ...STRUCTS,
    ...wgslConstants(SHADE_TRIS_SHADER),
    $b: integer$b,
    shadeCache: cache,
    work,
    pages,
    tileIds,
    SHADE_CACHE: !none,
    // A narrow grid: the triangles pass's dispatch holds x to it.
    GROUP_WIDTH: 2,
    decodeTriangle: exact.decodeTriangle,
    composeRowFrame: exact.composeRowFrame,
    vis: {},
    textureDimensions: () => [width, height],
    textureLoad: (_: unknown, p: V) => [vis[p[1]][p[0]], 0, 0, 0],
    workgroupBarrier: () => {
      if (atBarrier) throw STOP
    },
  }
  const passes = shaderRun<Record<string, Fn>>(
    SHADE_CACHE_SHADER,
    [
      'shade_marks',
      'markKind',
      'markTriangle',
      'rowMarks',
      'shade_rows',
      'flatIndex',
      'cachedTriangles',
      'openSlice',
      'groupGrid',
      'storeWord',
      'storeVec3',
      'storeRowFrame',
    ],
    scope,
  )
  const reads = shaderRun<Record<string, Fn>>(
    SHADE_TRIS_SHADER + shadeCacheReadWgsl(0).text,
    [
      'shade_tris',
      'flatIndex',
      'storeVec',
      'storeTriangle',
      'cachedSlot',
      'cachedTriangles',
      'rowMarks',
      'rowFrame',
      'cacheVec2',
      'cacheVec3',
      'cacheVec4',
      'pixelTriangle',
    ],
    scope,
  )
  /** One frame: the header, the marks and the dispatch cleared, then the three passes as the host
   *  dispatches them — the triangles over the dispatch the rows pass wrote. */
  const frame = (capacity: number) => {
    cache.length = 0
    cache.push(0, pages.length, capacity, 0, ...new Array(pages.length * 32).fill(0))
    work.splice(0, 3, 0, 0, 1)
    // No pass: the header alone, laid for no row, as the host lays it.
    if (none) return void cache.splice(0, cache.length, 0, 0, 0, 0)
    for (let ty = 0; ty < height / 8; ty++)
      for (let tx = 0; tx < width / 8; tx++)
        for (atBarrier of [true, false])
          for (let l = 0; l < 64; l++)
            try {
              passes.shade_marks([tx * 8 + (l % 8), ty * 8 + (l >> 3), 0], [l % 8, l >> 3, 0])
            } catch (error) {
              if (error !== STOP) throw error
            }
    for (let row = 0; row < pages.length; row++) passes.shade_rows([row, 0, 0], [1, 1, 1])
    for (let group = 0; group < work[0] * work[1]; group++)
      for (let lane = 0; lane < 64; lane++)
        reads.shade_tris([(group % work[0]) * 64 + lane, Math.floor(group / work[0]), 0], work)
  }
  return { pages, vis, frame, cache, work, reads, exact }
}
