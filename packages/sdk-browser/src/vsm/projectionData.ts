/**
 * Host side of the projection shader data: the packer of the record of
 * `VSM_PROJECTION_RECORD_BYTES` (288) read by `VsmProjectionRecord`, and the helpers that fill it.
 * The record holds what some shader reads, nothing else.
 *
 * The layout is the WGSL struct's (`VsmProjectionRecord`, `projectionDataWgsl.ts`); `RECORD_OFFSET`
 * follows it, and `projectionData.test.ts` holds the two together. Its order is by role: a record is
 * uploaded by the words that changed (`vsmWriteChanged`), and the words between two changed ones
 * go up with them: the words a light keeps while it lives (its kind, emitter, finest mip and level)
 * open the record, those its view and its turn move follow, the origin shift and the clipmap's
 * origin, which move with the eye every frame, lie together, and the corner, the range and the pad
 * close it.
 *
 * Matrices: 16 floats in the engine's column-major, column-vector convention (`m[column·4 + row]`),
 * as WGSL's mat4x4f reads them. All distances in metres.
 */
import { writeSplitDouble } from '../../../sdk-core/src/math/primitives/splitDouble.ts'
import { multiplyMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Inverse.ts'
import { VSM_LIGHT_KIND_DIRECTIONAL, VSM_PROJECTION_RECORD_BYTES } from './constants.ts'

/** Each field's byte offset in a record (`VsmProjectionRecord`). */
const RECORD_OFFSET = {
  lightKind: 0,
  emitterSize: 4,
  finestMip: 8,
  mapLevel: 12,
  lightViewToClip: 16,
  lightDirection: 80,
  levelsLeft: 92,
  planesToMapUv: 96,
  shiftedToMapUv: 160,
  originShiftHigh: 224,
  flags: 236,
  originShiftLow: 240,
  levelBias: 252,
  clipmapOrigin: 256,
  ditherTexels: 268,
  cornerSteps: 272,
  lightRange: 280,
} as const

/** A map's record, its matrices and vectors its own: a writer fills them in place frame after
 *  frame (`vsmDefaultProjectionData` makes them). */
export interface VsmProjectionDataValues {
  lightViewToClip: Float64Array
  shiftedToMapUv: Float64Array
  planesToMapUv: Float64Array
  /** Directional: −light travel direction; local lights: zero. */
  lightDirection: number[]
  lightKind: number
  /** Double precision, split high/low on write (a double-float vector). */
  originShift: number[]
  lightRange: number
  levelBias: number
  clipmapOrigin: number[]
  emitterSize: number
  cornerSteps: number[]
  /** A clipmap level's absolute level (log2 of its radius in centimetres, less one); a local
   *  light's is 0, which no shader reads (every read of it is a sun's). */
  mapLevel: number
  /** The levels of the clipmap from this one to its last, this one included; −1 for a local light,
   *  which every reader tells by a count of 0 or less. */
  levelsLeft: number
  flags: number
  ditherTexels: number
  finestMip: number
}

/** Default record, every array its own. */
export function vsmDefaultProjectionData(): VsmProjectionDataValues {
  return {
    lightViewToClip: new Float64Array(16),
    shiftedToMapUv: new Float64Array(16),
    planesToMapUv: new Float64Array(16),
    lightDirection: [0, 0, 0],
    lightKind: VSM_LIGHT_KIND_DIRECTIONAL,
    originShift: [0, 0, 0],
    lightRange: 0,
    levelBias: 0,
    clipmapOrigin: [0, 0, 0],
    emitterSize: 0,
    cornerSteps: [0, 0],
    mapLevel: 0,
    levelsLeft: 0,
    flags: 0,
    ditherTexels: 0,
    finestMip: 0,
  }
}

/** The views of an image of records, made once an image (`writeVsmProjectionData`). */
const VIEWS = new WeakMap<
  ArrayBuffer,
  { f: Float32Array; u: Uint32Array<ArrayBuffer>; i: Int32Array }
>()
const viewsOf = (out: ArrayBuffer) => {
  let views = VIEWS.get(out)
  if (!views)
    VIEWS.set(
      out,
      (views = { f: new Float32Array(out), u: new Uint32Array(out), i: new Int32Array(out) }),
    )
  return views
}
/** The words of an image of records, as an upload sends them (`vsmWriteChanged`). */
export const vsmProjectionWords = (image: ArrayBuffer) => viewsOf(image).u

/** Writes record `index` (the VSM id) of the projection data buffer image `out`. */
export function writeVsmProjectionData(
  out: ArrayBuffer,
  index: number,
  d: VsmProjectionDataValues,
) {
  const { f, u, i } = viewsOf(out),
    base = (index * VSM_PROJECTION_RECORD_BYTES) / 4,
    O = RECORD_OFFSET
  for (let k = 0; k < 16; k++) {
    f[base + O.lightViewToClip / 4 + k] = d.lightViewToClip[k]
    f[base + O.shiftedToMapUv / 4 + k] = d.shiftedToMapUv[k]
    f[base + O.planesToMapUv / 4 + k] = d.planesToMapUv[k]
  }
  for (let a = 0; a < 3; a++) {
    f[base + O.lightDirection / 4 + a] = d.lightDirection[a]
    writeSplitDouble(
      f,
      base + O.originShiftHigh / 4 + a,
      base + O.originShiftLow / 4 + a,
      d.originShift[a],
    )
    f[base + O.clipmapOrigin / 4 + a] = d.clipmapOrigin[a]
  }
  u[base + O.lightKind / 4] = d.lightKind
  f[base + O.lightRange / 4] = d.lightRange
  f[base + O.levelBias / 4] = d.levelBias
  f[base + O.emitterSize / 4] = d.emitterSize
  i[base + O.cornerSteps / 4] = d.cornerSteps[0]
  i[base + O.cornerSteps / 4 + 1] = d.cornerSteps[1]
  i[base + O.mapLevel / 4] = d.mapLevel
  i[base + O.levelsLeft / 4] = d.levelsLeft
  u[base + O.flags / 4] = d.flags >>> 0
  f[base + O.ditherTexels / 4] = d.ditherTexels
  u[base + O.finestMip / 4] = d.finestMip
  // The word after the range, the pad that closes the record: zero.
  u[base + O.lightRange / 4 + 1] = 0
}

/** Clip space to shadow UV: x·0.5+0.5, y·−0.5+0.5, z kept, column-vector form. */
const CLIP_TO_UV = new Float64Array([0.5, 0, 0, 0, 0, -0.5, 0, 0, 0, 0, 1, 0, 0.5, 0.5, 0, 1])

/** The shifted-to-shadow-UV matrix: `scaleBias · viewToClip · view`, the view applied first. */
export function vsmShadowUvMatrix(
  out: Float64Array,
  shiftedToShadowView: Float64Array,
  viewToClip: Float64Array,
) {
  multiplyMatrix4(out, viewToClip, shiftedToShadowView)
  multiplyMatrix4(out, CLIP_TO_UV, out)
  return out
}

const scratch = new Float64Array(16)

/** The normal matrix, transpose(inverse(UV)): it takes a plane (normal, offset) to UV space. */
export function vsmShadowUvNormalMatrix(
  out: Float64Array,
  shiftedToShadowView: Float64Array,
  viewToClip: Float64Array,
) {
  vsmShadowUvMatrix(scratch, shiftedToShadowView, viewToClip)
  invertMatrix4(scratch, scratch)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = scratch[r * 4 + c]
  return out
}
