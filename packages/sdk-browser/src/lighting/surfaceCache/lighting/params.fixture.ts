import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import {
  resolveSettingsInto,
  type SettingValues,
} from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { MAX_TRACE_DISTANCE_METRES } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'
import { shapeOf, writeLightingParams, type LightingImage } from './params.ts'
import { LIGHTING_PARAMS } from './layout.ts'

/** The lighting's settings at their defaults. */
export const lightingSettings = {} as SettingValues<typeof SURFACE_CACHE_RULES>
resolveSettingsInto(SURFACE_CACHE_RULES, {}, lightingSettings)

/** That `a` is `b`, to `tolerance`. */
export const near = (a: number, b: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`)

/** A view the words under test do not read: any matrix will do. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** An image the lighting's words are written for: the first frame, one page, the eye at the origin, the view `IDENTITY`,
 *  no history lost, no feedback — what `image` names in place. */
export const lightingImage = (image: Partial<LightingImage> = {}): LightingImage => ({
  frame: 1,
  noiseFrame: 0,
  pages: 1,
  eye: [0, 0, 0],
  viewProjection: IDENTITY,
  preExposure: 1,
  viewPreExposure: 1,
  firstClipmapExtent: 2500,
  maxTraceDistance: MAX_TRACE_DISTANCE_METRES,
  historyLost: false,
  feedback: false,
  tracedRadiosity: false,
  exposure: 1,
  ...image,
})

/** The world-to-clip matrix, column-major, of a camera at `eye` metres looking down -Z with a quarter turn of view, depth
 *  reversed with no far plane (`ndc = near / distance`). */
export function viewProjection(eye: readonly number[], near = 0.1) {
  const projection = new Float64Array(16)
  projection[0] = 1
  projection[5] = 1
  projection[14] = near
  projection[11] = -1
  const m = new Float64Array(projection)
  for (let row = 0; row < 4; row++)
    m[12 + row] =
      projection[12 + row] -
      (projection[row] * eye[0] + projection[4 + row] * eye[1] + projection[8 + row] * eye[2])
  return m
}

/** The distance outside plane `k` of the point `q` centimetres from the eye. */
export const outside = (planes: Float32Array, k: number, q: readonly number[]) =>
  planes[4 * k] * q[0] + planes[4 * k + 1] * q[1] + planes[4 * k + 2] * q[2] + planes[4 * k + 3]

/** The five planes of the frustum of a camera at `eye` as the parameters hold them. */
export function planesOf(eye: readonly number[]) {
  const words = new Uint32Array(LIGHTING_PARAMS.words)
  writeLightingParams(
    words,
    shapeOf(lightingSettings, 1024, false, WORD_LIGHT_FORMAT),
    lightingSettings,
    lightingImage({ eye, viewProjection: viewProjection(eye) }),
  )
  return new Float32Array(words.buffer, LIGHTING_PARAMS.at.frustum * 4, 20)
}
