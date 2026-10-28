// The ambient cubemap's angular filter on the processor (`ambientCubemapMips.ts` holds the cone of each mip and the faces' tables): the
// reference the GPU's kernel (`lighting/deferred/ambientCubemapFilterWgsl.ts` in the browser package) and the chain's own tests read.
import { mipSize } from '../../../math/src/scalar/integers.ts'
import { sphereMeetsCone } from '../../../math/src/geometry/sphere.ts'
import { cubemapMipCount } from '../scene/core/fogCubemap.ts'
import {
  AMBIENT_CUBEMAP_FACE_PERM,
  AMBIENT_CUBEMAP_FACE_SIGN,
  AMBIENT_CUBEMAP_MAX_COS,
  AMBIENT_CUBEMAP_SQRT8,
  ambientCubemapLevelCone,
} from './ambientCubemapMips.ts'

/** The direction (unit) of a face's side-space point `(u, v, 1)`, written into `out`. */
function sideToDirection(out: number[], face: number, u: number, v: number) {
  const length = Math.hypot(u, v, 1)
  const side = [u / length, v / length, 1 / length]
  const perm = AMBIENT_CUBEMAP_FACE_PERM[face],
    sign = AMBIENT_CUBEMAP_FACE_SIGN[face]
  for (let k = 0; k < 3; k++) out[k] = sign[k] * side[perm[k]]
  return out
}

/** The side-space vector of a unit direction on a face, written into `out`: the inverse of `sideToDirection`. */
function directionToSide(out: number[], face: number, direction: readonly number[]) {
  const perm = AMBIENT_CUBEMAP_FACE_PERM[face],
    sign = AMBIENT_CUBEMAP_FACE_SIGN[face]
  for (let k = 0; k < 3; k++) out[perm[k]] = sign[k] * direction[k]
  return out
}

/** The blocks of a face's quadtree still to visit: `x`, `y` and `block` of each, a depth-first walk that holds at most three a level. */
const stack = new Int32Array(3 * (3 * 11 + 1))
/** The sphere a block is tested with, and the cone's apex. */
const sphere = new Float64Array(4)
const APEX = [0, 0, 0]
const AXIS = [0, 0, 0]

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
    radiusScale = AMBIENT_CUBEMAP_SQRT8 / extent
  const kernelCos = Math.min(cos, AMBIENT_CUBEMAP_MAX_COS),
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
  const { cone, source } = ambientCubemapLevelCone(size, level)
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
