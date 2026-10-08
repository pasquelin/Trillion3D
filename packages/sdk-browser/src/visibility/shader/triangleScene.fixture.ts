// The frame `triangleCache.fixture.ts` runs the resolve's triangle cache on (`shadeCacheWgsl.ts`):
// five rows — two quantized pages, one carrying its deformation tail in the page pool, a
// source-buffer page, one deformed in the float pool, a sprite — and a visibility buffer of big
// triangles, slivers, lone pixels, the background, rows past the table and triangles past their
// page. With the stand-ins `shaderRun` lacks: WGSL's 3×3, the structures the text builds by name,
// integer division for the page decode (`homesDecode.test.ts`).
import { Mat } from '../../texture/shaderRun.fixture.ts'
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts'
import { F32_SCOPE } from '../../lighting/shaderRunF32.fixture.ts'
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts'
import { FLAG_CLUSTER_PAGE } from '../types.ts'
import { lcgFloatRandom } from '../../../../math/src/sequence/seeded.fixture.ts'

export type V = number[]
export type Fn = (...args: unknown[]) => unknown
export const f = Math.fround
const random = lcgFloatRandom(11)
const floats = (n: number, at: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => f(at(i)))

/** WGSL's 3×3 by its columns, multiplied in binary32. */
export class Mat3 {
  [column: number]: V
  constructor(columns: V[]) {
    columns.forEach((column, i) => (this[i] = [...column]))
  }
}
const mat3x3f = (...columns: V[]) => new Mat3(columns)
export const times = (m: Mat3, v: V) =>
  [0, 1, 2].map((r) => f(f(f(m[0][r] * v[0]) + f(m[1][r] * v[1])) + f(m[2][r] * v[2])))
export const STRUCTS = {
  mat3x3f,
  determinant: (m: Mat3) => F32_SCOPE.dot(m[0], F32_SCOPE.cross(m[1], m[2])),
  InvT3: (adj: Mat3, scale: number, regular: boolean) => ({ adj, scale, regular }),
  RowFrame: (invT: unknown, positive: boolean) => ({ invT, positive }),
  PixelTriangle: (...v: V[]) =>
    Object.fromEntries(
      'p0 p1 p2 w0 w1 w2 n0 n1 n2 uva uvb uvc iw'.split(' ').map((k, i) => [k, v[i]]),
    ),
  bitcast_vec2f: builtins.bitcast_f32,
  bitcast_vec3f: builtins.bitcast_f32,
  bitcast_vec4f: builtins.bitcast_f32,
  bitcast_vec4u: builtins.bitcast_vec3u,
  countLeadingZeros: (x: number) => Math.clz32(x),
  i32: (x: number) => x | 0,
}
/** WGSL integers where the page decode leans on them: division truncates, `>>` of an `i32` keeps
 *  its sign (`homesDecode.test.ts`). */
export const integer$b = (op: string, a: number, b: number) =>
  typeof a !== 'number' || typeof b !== 'number'
    ? builtins.$b(op, a, b)
    : op === '/'
      ? Math.trunc(a / b)
      : op === '>>' && a < 0
        ? a >> b
        : builtins.$b(op, a, b)

/** The pools and the page table. */
export function scene() {
  const words: number[] = [],
    pool: number[] = [],
    normals: number[] = []
  const quantized = (vertices: number) => {
    const at = words.length
    const page = encodeGeometryPage(
      Array.from({ length: vertices * 3 }, (_, i) =>
        i < vertices ? i : Math.floor(random() * vertices),
      ),
      {
        POSITION: {
          itemSize: 3,
          array: Float32Array.from(floats(vertices * 3, () => random() * 4 - 2)),
        },
        NORMAL: {
          itemSize: 3,
          array: Float32Array.from(floats(vertices * 3, () => random() * 2 - 1)),
        },
        TEXCOORD_0: { itemSize: 2, array: Float32Array.from(floats(vertices * 2, random)) },
      },
    ).data as Uint8Array
    words.push(...new Uint32Array(page.buffer, page.byteOffset, page.byteLength / 4), 0, 0)
    return { flags: FLAG_CLUSTER_PAGE, pageOffset: at, indexCount: vertices * 3 }
  }
  /** A deformation tail of `vertices` records of eleven floats: position, previous, normal. */
  const tail = (into: number[], vertices: number, bits: boolean) => {
    const at = into.length
    for (const x of floats(vertices * 11, () => random() * 4 - 2))
      into.push(bits ? new Uint32Array(new Float32Array([x]).buffer)[0] : x)
    return at + 1
  }
  const source = (vertices: number) => {
    const offset = words.length,
      vertexBase = pool.length / 3
    words.push(...Array.from({ length: vertices * 3 }, () => Math.floor(random() * vertices)))
    pool.push(...floats(vertices * 3, () => random() * 4 - 2))
    normals.push(...floats(vertices * 7, () => random() * 2 - 1))
    return { flags: 0, pageOffset: offset, indexCount: vertices * 3, vertexBase }
  }
  const world = (m: V) => new Mat(m.map(f))
  const SHEAR = world([1.5, 0, 0.2, 0, 0, 0.8, 0, 0, 0, 0.3, 1.2, 0, 0.2, -0.1, -6, 1])
  const MIRROR = world([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0, -7, 1])
  const row = <Page extends object>(page: Page, over: object = {}) => ({
    world: SHEAR,
    sprite: [0, 0],
    lineWidth: 0,
    vertexBase: 0,
    packedBase: 0,
    deformOutput: 0,
    ...page,
    ...over,
  })
  const pages = [row(quantized(20)), row(source(12), { world: MIRROR, flags: 256 })]
  pages.push(row(quantized(16), { deformOutput: 0 }))
  pages[2].deformOutput = tail(words, 16, true)
  const deformed = row(source(10))
  // A float-pool deformation reads its header just before its block, at `packedBase - 1`.
  pool.push(0, 0, 0, 0)
  deformed.packedBase = pool.length - 3
  deformed.deformOutput = (tail(pool, 10, false) | 0x80000000) >>> 0
  pages.push(deformed, row(quantized(20), { sprite: [0.3, 1], world: MIRROR }))
  const uvs = floats((pool.length / 3) * 2 + 64, random)
  return { pages, words, pool, normals, uvs }
}

/** The image: big triangles across tiles, a vertical sliver, two lone pixels of one triangle in
 *  two tiles, a run of two, lone pixels of their own, the background, a row past the table, a
 *  triangle past its page, and the rest a mix of small triangles. */
export function image(width: number, height: number, rows: number) {
  const id = (row: number, tri: number) => ((row + 1) << 8) | tri
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (x < 13 && y < 9) return id(0, 1)
      if (x >= 13 && y < 5) return id(1, 0)
      if (x === 20) return id(2, 2)
      if ((x === 2 && y === 12) || (x === 17 && y === 14)) return id(4, 3)
      if (y === 12 && (x === 5 || x === 6)) return id(4, 16)
      const lone = [3, 8, 14, 18].indexOf(x)
      if (y === 13 && lone >= 0) return id([0, 1, 2, 4][lone], [9, 9, 12, 15][lone])
      if (y === 15) return x % 3 ? id(3, x % 10) : 0
      if (x === 0) return id(rows + 2, 1)
      if (x === 1) return id(0, 255)
      return id(2 + (Math.floor(x / 3) % 3), Math.floor(random() * 6) + Math.floor(y / 4))
    }),
  )
}
