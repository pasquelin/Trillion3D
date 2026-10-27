import { mipSize } from '../../../math/src/scalar/integers.ts'
import { sphereMeetsCone } from '../../../math/src/geometry/sphere.ts'
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
const MAX_COS = 0.9999
/** `√8`: the diagonal of a square of side 2, over which a block's bounding sphere is sized. */
const SQRT8 = 2.8284271

/**
 * Each face of the cube as a signed permutation of its side space `(u, v, 1)` (`u` and `v` across and down the face from −1 to 1):
 * the direction's component `k` is `sign[k]` times the side vector's component `perm[k]`. The inverse of a signed permutation is the
 * transposed one with the same signs, so one table gives both ways.
 */
const FACE_PERM = [
  [2, 1, 0],
  [2, 1, 0],
  [0, 2, 1],
  [0, 2, 1],
  [0, 1, 2],
  [0, 1, 2],
] as const
const FACE_SIGN = [
  [1, -1, -1],
  [-1, -1, 1],
  [1, 1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [-1, -1, -1],
] as const

/** The direction (unit) of a face's side-space point `(u, v, 1)`, written into `out`. */
function sideToDirection(out: number[], face: number, u: number, v: number) {
  const length = Math.hypot(u, v, 1)
  const side = [u / length, v / length, 1 / length]
  const perm = FACE_PERM[face],
    sign = FACE_SIGN[face]
  for (let k = 0; k < 3; k++) out[k] = sign[k] * side[perm[k]]
  return out
}

/** The side-space vector of a unit direction on a face, written into `out`: the inverse of `sideToDirection`. */
function directionToSide(out: number[], face: number, direction: readonly number[]) {
  const perm = FACE_PERM[face],
    sign = FACE_SIGN[face]
  for (let k = 0; k < 3; k++) out[perm[k]] = sign[k] * direction[k]
  return out
}

/** The blocks of a face's quadtree still to visit: `x`, `y` and `block` of each, a depth-first walk that holds at most three a level. */
const stack = new Int32Array(3 * (3 * 11 + 1))
/** The sphere a block is tested with, and the cone's apex. */
const sphere = new Float64Array(4)
const APEX = [0, 0, 0]
const AXIS = [0, 0, 0]
const SIDE = [0, 0, 0]

/** The mean colour of the texels of the source mip `source` (`extent` texels a side, six faces) within the cone of half angle `cone` about the direction `direction`, written into `out` at `at`. */
function integrateCone(
  out: Float32Array,
  at: number,
  source: Float32Array,
  extent: number,
  direction: readonly number[],
  cone: number,
) {
  const sin = Math.sin(cone),
    cos = Math.cos(cone)
  const toWorld = 2 / extent,
    inverseExtent = 1 / extent,
    radiusScale = SQRT8 / extent
  const kernelCos = Math.min(cos, MAX_COS),
    inverseWidth = 1 / (1 - kernelCos)
  let r = 0,
    g = 0,
    b = 0,
    weights = 0
  for (let face = 0; face < 6; face++) {
    directionToSide(AXIS, face, direction)
    const base = face * extent * extent * 3
    stack[0] = 0
    stack[1] = 0
    stack[2] = extent
    let top = 3
    while (top > 0) {
      top -= 3
      const x = stack[top],
        y = stack[top + 1],
        block = stack[top + 2]
      if (block > 1) {
        const half = block * 0.5
        sphere[0] = (x + half) * toWorld - 1
        sphere[1] = (y + half) * toWorld - 1
        sphere[2] = 1
        sphere[3] = radiusScale * block
        if (!sphereMeetsCone(sphere, APEX, AXIS, 1, sin, cos)) continue
        const next = block / 2
        // The four quarters, the top-left one popped first.
        for (let quarter = 3; quarter >= 0; quarter--) {
          stack[top] = x + (quarter & 1 ? next : 0)
          stack[top + 1] = y + (quarter & 2 ? next : 0)
          stack[top + 2] = next
          top += 3
        }
        continue
      }
      const u = (x + 0.5) * inverseExtent * 2 - 1,
        v = (y + 0.5) * inverseExtent * 2 - 1
      const length = Math.hypot(u, v, 1)
      const dot = (AXIS[0] * u + AXIS[1] * v + AXIS[2]) / length
      if (dot > kernelCos) {
        let weight = 1 - (1 - dot) * inverseWidth
        weight = weight * weight * (3 - 2 * weight)
        const texel = base + (y * extent + x) * 3
        r += weight * source[texel]
        g += weight * source[texel + 1]
        b += weight * source[texel + 2]
        weights += weight
      }
    }
  }
  if (weights === 0) return
  out[at] = r / weights
  out[at + 1] = g / weights
  out[at + 2] = b / weights
}

/** The cube's mips averaged by four texels to one, down to one texel a face: what the angular filter reads. */
function averagedMips(base: Float32Array, size: number, count: number) {
  const mips = [base]
  for (let level = 1; level < count; level++) {
    const side = mipSize(size, level),
      previous = mips[level - 1],
      before = mipSize(size, level - 1)
    const mip = new Float32Array(6 * side * side * 3)
    for (let face = 0; face < 6; face++)
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          const first = ((face * before + y * 2) * before + x * 2) * 3
          const second = first + before * 3
          for (let k = 0; k < 3; k++)
            mip[((face * side + y) * side + x) * 3 + k] =
              (previous[first + k] +
                previous[first + 3 + k] +
                previous[second + k] +
                previous[second + 3 + k]) *
              0.25
        }
    mips.push(mip)
  }
  return mips
}

/** A cube ready to be filtered: its side, its mip count and its box-filtered mips, the source the angular filter reads. */
export interface PreparedAmbientCubemap {
  readonly size: number
  readonly averaged: readonly Float32Array[]
}

/** The mips of a prepared cube: down to one texel a face. */
export const preparedMipCount = (prepared: PreparedAmbientCubemap) => prepared.averaged.length

/**
 * The cube of `size` texels a side (a power of two, 16 at least: the chain must be longer than the convolution's distance from
 * its end) and `6 · size² · 3` linear numbers, made ready to filter. The one pass over the cube that every face of every mip
 * then reads.
 */
export function prepareAmbientCubemap(cube: {
  readonly size: number
  readonly texels: ArrayLike<number>
}): PreparedAmbientCubemap {
  return {
    size: cube.size,
    averaged: averagedMips(Float32Array.from(cube.texels), cube.size, cubemapMipCount(cube.size)),
  }
}

/** The cone of mip `level` of a prepared cube, and the box-filtered mip it is filtered from. */
function levelCone(prepared: PreparedAmbientCubemap, level: number) {
  const { size } = prepared,
    count = preparedMipCount(prepared)
  const normalized = level / (count - AMBIENT_CUBEMAP_DIFFUSE_MIP)
  const width = size * 2 ** -(normalized * count)
  const cone = Math.min(Math.max(MAX_CONE * (1 / width), MIN_CONE), MAX_CONE)
  const cap = 2 * Math.PI * UNIT_AREA_RADIUS * (UNIT_AREA_RADIUS * (1 - Math.cos(cone)))
  const source = Math.min(
    Math.max(Math.trunc(0.5 * Math.log2(cap) + count - QUALITY_BIAS), 0),
    count - 1,
  )
  return { cone, source }
}

/**
 * `rows` rows from row `first` of one face of mip `level` of a prepared cube, filtered, written into `out` (`side · rows · 3` numbers, row by row
 * from the face's top-left corner, a texel nothing lies within the cone of left as it is): the unit of work a frame spends its budget on, a
 * face being many thousands of cone integrals at the first mips.
 */
export function ambientCubemapMipRows(
  prepared: PreparedAmbientCubemap,
  level: number,
  face: number,
  first: number,
  rows: number,
  out: Float32Array,
) {
  const { size, averaged } = prepared
  const { cone, source } = levelCone(prepared, level)
  const side = mipSize(size, level),
    sourceSide = mipSize(size, source)
  const direction = [0, 0, 0]
  out.fill(0, 0, side * rows * 3)
  for (let y = first; y < first + rows; y++)
    for (let x = 0; x < side; x++) {
      sideToDirection(
        direction,
        face,
        (x + 0.5) * (1 / side) * 2 - 1,
        (y + 0.5) * (1 / side) * 2 - 1,
      )
      integrateCone(
        out,
        ((y - first) * side + x) * 3,
        averaged[source],
        sourceSide,
        direction,
        cone,
      )
    }
}
