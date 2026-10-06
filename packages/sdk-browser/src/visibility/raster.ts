import { signedArea, type Projected } from './projection.ts'
import { matrixWindingCw } from '../../../sdk-core/src/index.ts'
import { uvTransformed } from '../../../sdk-core/src/texture/contract.ts'
import { refreshSurface, surfaceOpacity, surfaceSide, type PageSurface } from '../page/surface.ts'
import { lineDash } from './shader/lineWgsl.ts'
import { DEPTH_CLEAR, depthNearer } from '../camera/depthConvention.ts'
import { triangleAt, perspectiveBary, mapTexel } from './math.ts'
import {
  assertVisibilityPageTriangles,
  textureRgba,
  VIS_MAX_PAGES,
  VIS_TRIANGLE_MASK,
  type VisPage,
} from './types.ts'
import type { EngineCamera } from '../camera/world.ts'
import { locationOf, type PageLocations } from '../page/selection/placements.ts'
import type { HostAttributes } from '../host/resources.ts'

/** Interpolated alpha of the vertex colours; a three-component colour reads an alpha of one. */
function vertexAlpha(
  color: HostAttributes[string],
  tri: { i0: number; i1: number; i2: number },
  bary: { w0: number; w1: number; w2: number },
) {
  if (color.itemSize < 4) return 1
  const a = (i: number) => color.getComponent(i, 3)
  return a(tri.i0) * bary.w0 + a(tri.i1) * bary.w1 + a(tri.i2) * bary.w2
}

/**
 * What drops a pixel of a page's triangle, as the GPU rasters drop it, or nothing: a dashed line's
 * gaps (`lineDash`) at the distance its first coordinate carries, then a masked surface's cutout,
 * the base map alpha times the opacity and the vertex alpha (`maskKeep`, `./shader/pageWgsl.ts`).
 */
export function cutout(
  page: VisPage,
  tri: NonNullable<ReturnType<typeof triangleAt>>,
  mat: PageSurface,
  color: HostAttributes[string] | undefined,
  transformed: boolean,
) {
  const uv = page.attributes.uv,
    dashed = mat.dashSize !== undefined && !!uv,
    opacity = surfaceOpacity(mat),
    masked = mat.alphaTest > 0 && (!!mat.map || !!color || opacity < mat.alphaTest)
  if (!dashed && !masked) return undefined
  return (_x: number, _y: number, w0: number, w1: number, w2: number) => {
    const bary = perspectiveBary(tri.a, tri.b, tri.c, { w0, w1, w2 })
    const u = uv
      ? uv.getX(tri.i0) * bary.w0 + uv.getX(tri.i1) * bary.w1 + uv.getX(tri.i2) * bary.w2
      : 0
    if (dashed && !lineDash(u, mat.dashSize!, mat.gapSize ?? 0)) return false
    if (!masked) return true
    let alpha = (color ? vertexAlpha(color, tri, bary) : 1) * opacity
    const rgba = mat.map && textureRgba(mat.map)
    if (!rgba) return alpha >= mat.alphaTest
    const v = uv
      ? uv.getY(tri.i0) * bary.w0 + uv.getY(tri.i1) * bary.w1 + uv.getY(tri.i2) * bary.w2
      : 0
    const texel = mapTexel(rgba, mat.map!, u, v, transformed)
    alpha *= rgba.data[texel + 3] / 255
    return alpha >= mat.alphaTest
  }
}

/**
 * A pixel leaves the triangle where an edge's numerator and the area differ in sign: that is
 * tested before the division, which only a pixel still inside pays. The test never says out where
 * the quotient's `w < 0` says in: past `|area| · 2^-1000` (below an area of 1, at any nonzero
 * numerator) the quotient cannot round to -0, and a numerator nearer zero, a NaN or an infinite
 * area are left to the division.
 */
function fillDepth(
  depth: Float32Array,
  width: number,
  height: number,
  a: Projected,
  b: Projected,
  c: Projected,
  keep?: (x: number, y: number, w0: number, w1: number, w2: number) => boolean,
) {
  const area = signedArea(a, b, c)
  if (area === 0) return
  const sign = area > 0 ? 1 : -1,
    outside = -Math.abs(area) * 2 ** -1000
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))),
    maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)))
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))),
    maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)))
  const ax = a.x,
    ay = a.y,
    az = a.z
  const bx = b.x,
    by = b.y,
    bz = b.z
  const cx = c.x,
    cy = c.y,
    cz = c.z
  for (let y = minY; y <= maxY; y++) {
    const cy_y = cy - y,
      by_y = by - y,
      ay_y = ay - y
    const row = y * width
    for (let x = minX; x <= maxX; x++) {
      const bx_x = bx - x,
        cx_x = cx - x
      const n0 = bx_x * cy_y - cx_x * by_y
      if (n0 * sign < outside) continue
      const ax_x = ax - x
      const n1 = cx_x * ay_y - ax_x * cy_y
      if (n1 * sign < outside) continue
      const w0 = n0 / area
      if (w0 < 0) continue
      const w1 = n1 / area
      if (w1 < 0) continue
      const w2 = 1 - w0 - w1
      if (w2 < 0) continue
      if (keep && !keep(x, y, w0, w1, w2)) continue
      const z = w0 * az + w1 * bz + w2 * cz,
        o = row + x
      if (!depthNearer(z, depth[o])) continue
      depth[o] = z
    }
  }
}

/** The raster itself, into the depth the caller hands it: the sentinel is cleared over the
 *  image's own pixels and left at the far value, whatever the buffer holds beyond them. The CPU
 *  image's identifiers are the oracle's (`bench/oracles/browser/cpu-image/raster.ts`). */
function rasterise(
  pages: VisPage[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  pixelRatio: number,
  depth: Float32Array,
) {
  const [width, height] = viewport,
    pixels = width * height
  depth.fill(-Infinity, 0, pixels)
  for (let pageIndex = 0; pageIndex < pages.length && pageIndex < VIS_MAX_PAGES; pageIndex++) {
    const page = pages[pageIndex],
      index = page.array
    if (!page.attributes.position) continue
    // Once per page and per image: the host writes its raster state — a side, an alpha cutoff
    // — on the declaration it shares with its mesh, and this raster is an oracle of what it
    // declares NOW.
    const mat = refreshSurface(page.material),
      side = surfaceSide(mat)
    // A reflection reverses the walk direction on screen: the face to drop is the other one, as
    // `visBin` does for WebGPU pipelines (`frontFaceCW`). Without this
    // flip, this rasterizer drew under reflection exactly the faces that cone rejection
    // drops — and its own shading (`visibilityLighting`) already flipped the sign.
    const world = locationOf(locations, pageIndex).world,
      positif = (side === 'back') !== matrixWindingCw(world.elements)
    const transformed = !!mat.map && uvTransformed(mat.map.transform)
    // Vertex colours tint, and cut, only where the material asks, as the GPU rows do.
    const color = mat.vertexColors ? page.attributes.color : undefined
    const triangles = assertVisibilityPageTriangles((index.length / 3) | 0)
    for (let t = 0; t < triangles && t <= VIS_TRIANGLE_MASK; t++) {
      const tri = triangleAt(page, world, t, cam, width, height, pixelRatio)
      if (!tri) continue
      const area = signedArea(tri.a, tri.b, tri.c)
      if (side !== 'double' && (positif ? area <= 0 : area >= 0)) continue
      const keep = cutout(page, tri, mat, color, transformed)
      fillDepth(depth, width, height, tri.a, tri.b, tri.c, keep)
    }
  }
  for (let i = 0; i < pixels; i++) if (depth[i] === -Infinity) depth[i] = DEPTH_CLEAR
}

/**
 * The same raster, depth only: the Hi-Z pyramid is built from the depth and from nothing else, and
 * it copies it into its own buffer (`sdk-core/src/hiz/pyramidFlat.ts:107`), so a cut that shades
 * nothing was writing four bytes per pixel into an array nobody read. `into` belongs to the caller
 * and is cleared over this image's pixels on every call, whatever it held: a buffer of a wider
 * image keeps its tail, which no reader of this one reaches.
 *
 * `into` must hold `width * height` values. A buffer too short is refused by the name the pyramid
 * itself raises, never grown here: the caller that owns it knows the viewport before the raster.
 */
export function rasterDepth(
  pages: VisPage[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  pixelRatio: number,
  into: Float32Array,
) {
  if (into.length < viewport[0] * viewport[1]) throw new Error('HIZ_DEPTH_SIZE')
  rasterise(pages, locations, cam, viewport, pixelRatio, into)
  return into
}
