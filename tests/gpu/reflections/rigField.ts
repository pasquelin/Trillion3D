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

const CENTIMETRES = 100
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
function triangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3) {
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

/** The field the rig's `faces` make, its resources on `device`, to be disposed; the stand-in of a scene with none
 *  where there are no faces. */
export function rigField(
  device: GPUDevice,
  standIns: DeferredPlaceholders,
  faces: readonly RigFace[] = [],
): { field: GlobalFieldRead; dispose(): void } {
  if (!faces.length) return { field: standIns.distanceField, dispose() {} }
  const triangles = faces.flatMap(({ triangles: words }) =>
    [0, 1].map((k) => [0, 1, 2].map((v) => [...words.subarray(9 * k + 3 * v, 9 * k + 3 * v + 3)])),
  ) as Vec3[][]
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity]
  for (const triangle of triangles)
    for (const point of triangle)
      point.forEach((c, a) => ((low[a] = Math.min(low[a], c)), (high[a] = Math.max(high[a], c))))
  const centre = low.map((l, a) => ((l + high[a]) / 2) * CENTIMETRES) as Vec3
  const extent = (Math.max(...low.map((l, a) => high[a] - l)) / 2) * CENTIMETRES * MARGIN
  const sdf = (p: Vec3) =>
    CENTIMETRES *
    Math.min(
      ...triangles.map(([a, b, c]) =>
        triangleDistance(p.map((x) => x / CENTIMETRES) as Vec3, a, b, c),
      ),
    )
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
