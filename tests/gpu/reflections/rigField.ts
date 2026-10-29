// What the reflection rig binds as the global distance field (`rig.ts`): the field of the rig's faces
// (`rigRuntime.ts`), the distance to the nearest of their triangles — a thin surface, zero on it — built as the
// passes build one (`syntheticField.fixture.ts`) in a single clipmap that holds the faces, in the field's unit, the
// centimetre; or, without faces, the engine's stand-in of a scene with none (`DeferredPlaceholders.distanceField`):
// a view that holds no clipmap, whose rays answer nothing.
import {
  fieldArrays,
  gdfViewWords,
  type Vec3,
} from '../../../packages/sdk-browser/src/lighting/distanceField/syntheticField.fixture.ts'
import {
  globalReadGroupEntries,
  type GlobalFieldRead,
} from '../../../packages/sdk-browser/src/lighting/distanceField/view.ts'
import { length3 } from '../../../packages/math/src/vector/vector.ts'
import type { DeferredPlaceholders } from '../../../packages/sdk-browser/src/lighting/deferred/setup.ts'
import type { RigFace } from './rigRuntime.ts'

export const CENTIMETRES = 100
/** The pages along the rig's clipmap: 56 voxels across the faces' box, widened by a third. */
const PAGES = 8
const MARGIN = 4 / 3

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const along = (a: Vec3, d: Vec3, t: number): Vec3 => [
  a[0] + d[0] * t,
  a[1] + d[1] * t,
  a[2] + d[2] * t,
]

/** The distance from `p` to the triangle `a, b, c`: the closest point of its plane's region, by the regions of its
 *  vertices, edges and face. */
export function triangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3) {
  const ab = sub(b, a),
    ac = sub(c, a),
    ap = sub(p, a)
  const d1 = dot(ab, ap),
    d2 = dot(ac, ap)
  let closest: Vec3 | undefined = d1 <= 0 && d2 <= 0 ? a : undefined
  const bp = sub(p, b)
  const d3 = dot(ab, bp),
    d4 = dot(ac, bp)
  if (!closest && d3 >= 0 && d4 <= d3) closest = b
  const vc = d1 * d4 - d3 * d2
  if (!closest && vc <= 0 && d1 >= 0 && d3 <= 0) closest = along(a, ab, d1 / (d1 - d3))
  const cp = sub(p, c)
  const d5 = dot(ab, cp),
    d6 = dot(ac, cp)
  if (!closest && d6 >= 0 && d5 <= d6) closest = c
  const vb = d5 * d2 - d1 * d6
  if (!closest && vb <= 0 && d2 >= 0 && d6 <= 0) closest = along(a, ac, d2 / (d2 - d6))
  const va = d3 * d6 - d5 * d4
  if (!closest && va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0)
    closest = along(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)))
  if (!closest) {
    const scale = 1 / (va + vb + vc)
    closest = along(along(a, ab, vb * scale), ac, vc * scale)
  }
  return length3(...sub(p, closest))
}

/** The triangles of each of `faces`, in metres, as points. */
export const meshesOf = (faces: readonly RigFace[]) =>
  faces.map(({ triangles: words }) =>
    Array.from({ length: words.length / 9 }, (_, k) =>
      [0, 1, 2].map((v) => [...words.subarray(9 * k + 3 * v, 9 * k + 3 * v + 3)]),
    ),
  ) as Vec3[][][]

/** Whether the triangles of `mesh` close a volume: every edge is shared by two of them. */
function isClosed(mesh: readonly Vec3[][]) {
  const key = (p: Vec3) => p.map((x) => Math.round(x * 1e4)).join(',')
  const count = new Map<string, number>()
  for (const [a, b, c] of mesh)
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [Vec3, Vec3][]) {
      const edge = [key(p), key(q)].sort().join('|')
      count.set(edge, (count.get(edge) ?? 0) + 1)
    }
  return [...count.values()].every((n) => n === 2)
}

/** The distance `t` ≥ 0 along the ray `o + t·d` to the triangle at `v[at..at + 9]`, either side, Infinity when it misses: Möller–Trumbore, the
 *  triangle's edges taken `slack` wide in barycentric units (the ray of a card's texel may run along a diagonal of a face). */
export function rayCrossing(
  o: ArrayLike<number>,
  d: ArrayLike<number>,
  v: ArrayLike<number>,
  at: number,
  slack: number,
) {
  const e1 = [0, 1, 2].map((i) => v[at + 3 + i] - v[at + i])
  const e2 = [0, 1, 2].map((i) => v[at + 6 + i] - v[at + i])
  const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]
  if (Math.abs(det) < 1e-12) return Infinity
  const s = [0, 1, 2].map((i) => o[i] - v[at + i])
  const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
  const w = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det
  return u >= -slack && w >= -slack && u + w <= 1 + slack && t >= 0 ? t : Infinity
}

/** The directions of the inside test: along no axis nor diagonal of a box. A ray through an edge of the mesh counts two crossings and turns its
 *  parity, so the three vote. */
const PROBES: Vec3[] = [
  [0.83, 0.37, 0.41],
  [-0.29, 0.71, 0.64],
  [0.52, -0.43, 0.74],
]

/** Whether `p` lies inside the closed mesh of `words` (triangles, nine numbers each): most rays from it cross an odd number of triangles. */
function insideMesh(p: Vec3, words: Float32Array) {
  let odd = 0
  for (const probe of PROBES) {
    let crossings = 0
    for (let at = 0; at < words.length; at += 9)
      if (rayCrossing(p, probe, words, at, 0) < Infinity) crossings++
    odd += crossings % 2
  }
  return odd >= 2
}

/** The one clipmap of the rig's field: its centre and half extent in centimetres, and the pages along a side. */
export type RigClipmap = { centre: Vec3; extent: number; pages: number }

/** The field the rig's `faces` make, its resources on `device`, to be disposed; the stand-in of a scene with none
 *  where there are no faces. */
export function rigField(
  device: GPUDevice,
  standIns: DeferredPlaceholders,
  faces: readonly RigFace[] = [],
): { field: GlobalFieldRead; dispose(): void; clipmap?: RigClipmap } {
  if (!faces.length) return { field: standIns.distanceField, dispose() {} }
  const meshes = meshesOf(faces)
  const triangles = meshes.flat()
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity]
  for (const triangle of triangles)
    for (const point of triangle)
      point.forEach((c, a) => ((low[a] = Math.min(low[a], c)), (high[a] = Math.max(high[a], c))))
  const centre = low.map((l, a) => ((l + high[a]) / 2) * CENTIMETRES) as Vec3
  const extent = (Math.max(...low.map((l, a) => high[a] - l)) / 2) * CENTIMETRES * MARGIN
  // The field of a closed face is signed, negative inside, as a mesh's volume is: the distance of a thick surface is linear across
  // it, so a march that steps over the surface reads a negative distance and is placed back on it. An open face is thin, zero on it.
  // Where closed faces overlap (the body and its teeth) the least of their fields is not the exact field of their union inside them;
  // a ray that starts outside every face never reads that.
  const solids = meshes.map((mesh) => isClosed(mesh))
  const sdf = (p: Vec3) => {
    const metres = p.map((x) => x / CENTIMETRES) as Vec3
    return (
      CENTIMETRES *
      Math.min(
        ...meshes.map((mesh, k) => {
          const d = Math.min(...mesh.map(([a, b, c]) => triangleDistance(metres, a, b, c)))
          return solids[k] && insideMesh(metres, faces[k].triangles) ? -d : d
        }),
      )
    )
  }
  const { view, table, atlas, mip, mipSide, pages, count } = fieldArrays({
    extents: [extent],
    centre,
    pages: PAGES,
    sdf,
  })
  const volume = (
    words: Uint32Array<ArrayBuffer> | Float32Array<ArrayBuffer>,
    format: GPUTextureFormat,
    side: number,
  ) => {
    const texture = device.createTexture({
      size: [side, side, side * count],
      dimension: '3d',
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture }, words, { bytesPerRow: side * 4, rowsPerImage: side }, [
      side,
      side,
      side * count,
    ])
    return texture
  }
  const read = volume(table, 'r32uint', pages)
  const mips = volume(mip, 'r32float', mipSide)
  const pagesBuffer = device.createBuffer({
    size: atlas.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(pagesBuffer, 0, atlas)
  // The page atlas is the buffer here (the coverage atlas past its pages), its texture and sampler stand-ins of one texel.
  const atlasTexture = device.createTexture({
    size: [1, 1, 1],
    dimension: '3d',
    format: 'r8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const atlasSampler = device.createSampler()
  const block = gdfViewWords(view)
  const viewBuffer = device.createBuffer({
    size: block.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(viewBuffer, 0, block)
  return {
    clipmap: { centre, extent, pages: PAGES },
    field: {
      readEntries: (first) =>
        globalReadGroupEntries(
          first,
          { buffer: viewBuffer },
          {
            read,
            atlas: pagesBuffer,
            atlasTexture,
            atlasSampler,
            mip: mips,
          },
        ),
      readGeneration: 0,
    },
    dispose() {
      read.destroy()
      mips.destroy()
      pagesBuffer.destroy()
      atlasTexture.destroy()
      viewBuffer.destroy()
    },
  }
}
