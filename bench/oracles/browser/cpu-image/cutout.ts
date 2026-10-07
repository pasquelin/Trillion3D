// What the CPU visbuffer (`./raster.ts`) drops of a triangle, as the GPU rasters drop it.
import {
  surfaceOpacity,
  type PageSurface,
} from '../../../../packages/sdk-browser/src/page/surface.ts'
import { perspectiveBary, mapTexel } from '../../../../packages/sdk-browser/src/visibility/math.ts'
import { textureRgba, type VisPage } from '../../../../packages/sdk-browser/src/visibility/types.ts'
import type { HostAttributes } from '../../../../packages/sdk-browser/src/host/resources.ts'
import { lineDash } from './line.ts'
import type { triangleAt } from './projection.ts'

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
 * the base map alpha times the opacity and the vertex alpha (`maskKeep`,
 * `packages/sdk-browser/src/visibility/shader/pageWgsl.ts`).
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
