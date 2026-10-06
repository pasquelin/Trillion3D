// The CPU visbuffer: packed identifiers and depth, the oracle the GPU rasters are compared to. The
// engine's own CPU raster is `rasterDepth` (`packages/sdk-browser/src/visibility/raster.ts`), the
// depth alone for the Hi-Z; this one keeps the identifier of the winning triangle too, and a test
// holds the two depths equal (`rasterDepth.test.ts`).
import {
  signedArea,
  type Projected,
} from '../../../../packages/sdk-browser/src/visibility/projection.ts'
import { matrixWindingCw } from '../../../../packages/sdk-core/src/index.ts'
import { uvTransformed } from '../../../../packages/sdk-core/src/texture/contract.ts'
import { refreshSurface, surfaceSide } from '../../../../packages/sdk-browser/src/page/surface.ts'
import {
  DEPTH_CLEAR,
  depthNearer,
} from '../../../../packages/sdk-browser/src/camera/depthConvention.ts'
import { triangleAt } from '../../../../packages/sdk-browser/src/visibility/math.ts'
import {
  assertVisibilityPageTriangles,
  VIS_MAX_PAGES,
  VIS_TRIANGLE_MASK,
  type VisPage,
} from '../../../../packages/sdk-browser/src/visibility/types.ts'
import { packVisibilityId } from './ids.ts'
import { cutout } from '../../../../packages/sdk-browser/src/visibility/raster.ts'
import type { EngineCamera } from '../../../../packages/sdk-browser/src/camera/world.ts'
import {
  locationOf,
  type PageLocations,
} from '../../../../packages/sdk-browser/src/page/selection/placements.ts'
import { DEFAULT_PIXEL_RATIO } from '../../../../packages/sdk-browser/src/backend/common.ts'

/**
 * A pixel leaves the triangle where an edge's numerator and the area differ in sign: that is
 * tested before the division, which only a pixel still inside pays. The test never says out where
 * the quotient's `w < 0` says in: past `|area| · 2^-1000` (below an area of 1, at any nonzero
 * numerator) the quotient cannot round to -0, and a numerator nearer zero, a NaN or an infinite
 * area are left to the division.
 */
function fillIds(
  ids: Uint32Array,
  depth: Float32Array,
  width: number,
  height: number,
  a: Projected,
  b: Projected,
  c: Projected,
  packed: number,
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
      ids[o] = packed
    }
  }
}

/** CPU visbuffer: packed IDs plus NDC z (background at the far value). Engine depth is
 *  reversed, so the GREATEST wins; at equal depth, the first write stays. A line page's quads are
 *  widened at `pixelRatio` image pixels per CSS pixel, as the GPU rasters widen them. */
export function rasterVisibility(
  pages: VisPage[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  pixelRatio = DEFAULT_PIXEL_RATIO,
) {
  const [width, height] = viewport,
    pixels = width * height,
    ids = new Uint32Array(pixels),
    depth = new Float32Array(pixels).fill(-Infinity)
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
    // `visBin` does for WebGPU pipelines and Three for WebGL (`frontFaceCW`). Without this
    // flip, this rasterizer drew under reflection exactly the faces that cone rejection
    // drops — and its own shading (`visibilityLighting`) already flipped the sign.
    const world = locationOf(locations, pageIndex).world,
      positiveArea = (side === 'back') !== matrixWindingCw(world.elements)
    const transformed = !!mat.map && uvTransformed(mat.map.transform)
    // Vertex colours tint, and cut, only where the material asks, as the GPU rows do.
    const color = mat.vertexColors ? page.attributes.color : undefined
    const triangles = assertVisibilityPageTriangles((index.length / 3) | 0)
    for (let t = 0; t < triangles && t <= VIS_TRIANGLE_MASK; t++) {
      const tri = triangleAt(page, world, t, cam, width, height, pixelRatio)
      if (!tri) continue
      const area = signedArea(tri.a, tri.b, tri.c)
      if (side !== 'double' && (positiveArea ? area <= 0 : area >= 0)) continue
      const keep = cutout(page, tri, mat, color, transformed)
      fillIds(ids, depth, width, height, tri.a, tri.b, tri.c, packVisibilityId(pageIndex, t), keep)
    }
  }
  for (let i = 0; i < pixels; i++) if (depth[i] === -Infinity) depth[i] = DEPTH_CLEAR
  return { ids, depth }
}

export function rasterVisibilityIds(
  pages: VisPage[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  pixelRatio = DEFAULT_PIXEL_RATIO,
) {
  return rasterVisibility(pages, locations, cam, viewport, pixelRatio).ids
}
