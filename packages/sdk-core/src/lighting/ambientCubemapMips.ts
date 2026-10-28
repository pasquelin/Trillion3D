import { cubemapMipCount } from '../scene/core/fogCubemap.ts'

/**
 * THE MIP CHAIN OF THE AMBIENT CUBEMAP, filtered by angle: each mip of the cube is the cube seen through a cone of its own, wider
 * the further down the chain, until the last mips hold the cube convolved by the whole hemisphere. The shader picks a mip by the
 * roughness of the reflection (`cubemapMipFromRoughness`) and, for the diffuse light along a normal, the mip
 * `AMBIENT_CUBEMAP_DIFFUSE_MIP` above the last (`cubemapMipCount` mips in all). The faces are a cube texture's, in the order +x, -x, +y, -y, +z, -z, each row
 * by row from its top-left corner, the directions the texture is looked up by.
 *
 * For mip `level` of `count` (side `size` halving): the cone's half angle is π/2 over the width `size · 2^(-level · count / (count - 4))`
 * the mip would have were the chain stretched so that it reaches the hemisphere at `count - 4`, held between 0.002 and π/2; each
 * texel is the mean of the texels of a source mip within the cone of its direction, weighed by a smoothstep of how near the cone's axis
 * the texel lies. The source mip is a box-filtered one of the cube, picked from the area of the cone's cap so that the cone
 * covers several of its texels; the faces' quadtrees are walked only where a bounding sphere meets the cone.
 *
 * The engine filters the chain on the GPU, once (`lighting/deferred/ambientCubemapFilterWgsl.ts` in the browser package), from the tables and
 * the cone of each mip given here (`ambientCubemapLevelCone`, the face tables); the processor's filter the kernel is tested against
 * is a fixture (`ambientCubemapMips.fixture.ts`).
 */

/** How many mips above the last the convolution by the whole hemisphere sits: the diffuse light is read at mip `n - 4`. */
export const AMBIENT_CUBEMAP_DIFFUSE_MIP = 4

/** The most the cone's half angle is held to, a quarter turn: the hemisphere; also the angle of a texel as wide as the cube. */
const MAX_CONE = Math.PI / 2
/** The least the cone's angle is held to, in radians. */
const MIN_CONE = 0.002
/** The radius of the sphere whose surface is one unit, `1 / (2 √π)`, with the cone's cap area the source mip is picked by. */
const UNIT_AREA_RADIUS = 0.28209478
/** How many mips finer than the cone's cap the source mip is taken. */
const QUALITY_BIAS = 3
/** The cosine above which a texel is out of the cone's centre, held under 1 so that the kernel has a width. */
export const AMBIENT_CUBEMAP_MAX_COS = 0.9999
/** `√8`: the diagonal of a square of side 2, over which a block's bounding sphere is sized. */
export const AMBIENT_CUBEMAP_SQRT8 = 2.8284271

/**
 * Each face of the cube as a signed permutation of its side space `(u, v, 1)` (`u` and `v` across and down the face from −1 to 1):
 * the direction's component `k` is `sign[k]` times the side vector's component `perm[k]`. The inverse of a signed permutation is the
 * transposed one with the same signs, so one table gives both ways.
 */
export const AMBIENT_CUBEMAP_FACE_PERM = [
  [2, 1, 0],
  [2, 1, 0],
  [0, 2, 1],
  [0, 2, 1],
  [0, 1, 2],
  [0, 1, 2],
] as const
export const AMBIENT_CUBEMAP_FACE_SIGN = [
  [1, -1, -1],
  [-1, -1, 1],
  [1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [-1, -1, -1],
] as const

/**
 * The cone of mip `level` of a cube of `size` texels a side, and the box-filtered mip it is filtered from: the cone's half angle with its
 * sine and cosine, and the width of the kernel's smoothstep (`kernelCos` the cosine the kernel stops at, `inverseWidth` the inverse
 * of its distance from one): what the filter of every texel of the mip is made of.
 */
export function ambientCubemapLevelCone(size: number, level: number) {
  const count = cubemapMipCount(size)
  const normalized = level / (count - AMBIENT_CUBEMAP_DIFFUSE_MIP)
  const width = size * 2 ** -(normalized * count)
  const cone = Math.min(Math.max(MAX_CONE * (1 / width), MIN_CONE), MAX_CONE)
  const cap = 2 * Math.PI * UNIT_AREA_RADIUS * (UNIT_AREA_RADIUS * (1 - Math.cos(cone)))
  const source = Math.min(
    Math.max(Math.trunc(0.5 * Math.log2(cap) + count - QUALITY_BIAS), 0),
    count - 1,
  )
  const sin = Math.sin(cone),
    cos = Math.cos(cone)
  const kernelCos = Math.min(cos, AMBIENT_CUBEMAP_MAX_COS)
  return { cone, source, sin, cos, kernelCos, inverseWidth: 1 / (1 - kernelCos) }
}
