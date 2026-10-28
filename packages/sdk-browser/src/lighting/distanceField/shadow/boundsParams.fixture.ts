// What the sun's distance-field shadow tests share (`boundsParams.test.ts`, `boundsPlacement.test.ts`): a
// camera, a sun, the settings and the uniform a light is placed in.
import assert from 'node:assert/strict'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { DFSH_PARAMS_STRIDE } from './layout.ts'
import {
  boundsOf,
  writeDfshParams,
  type DfshImage,
  type DfshLight,
  type DfshSettings,
} from './params.ts'

export const near = (a: number, b: number, why: string, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${why}: ${a} against ${b}`)
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The camera of a 1000 × 500 view at `eye` (metres), looking down -z, a 90 degree field across, near 10 m. */
export function camera(eye = [0, 0, 0]): DfshImage {
  const f = 1,
    aspect = 2,
    nearPlane = 10
  const projection = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, nearPlane, 0]
  const world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, eye[0], eye[1], eye[2], 1]
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eye[0], -eye[1], -eye[2], 1]
  // projection · view, column-major.
  const viewProjection = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        viewProjection[c * 4 + r] += projection[k * 4 + r] * view[c * 4 + k]
  return {
    ...{ view: [1000, 500], extent: [1024, 512], world, projection, viewProjection },
    ...{ eye, near: nearPlane, far: 5000, perspective: true },
  }
}

export const SUN: DfshLight = {
  lane: 1,
  toLight: [0, 1, 0],
  angularRadius: 0.5357 * DEG2RAD,
  cascade: {
    ...{ near: 100, far: 512, minDepth: 73, maxDepth: 512 },
    ...{ fadeOffset: 500, invFadeLength: 1 / 12, nearFadeOffset: 73, invNearFadeLength: 1 / 27 },
  },
  traceDistance: 100,
  rayStartOffset: 0.003,
  amount: 1,
}

export const SETTINGS: DfshSettings = {
  ...{ quality: 3, fullResolution: false, tileSize: 2 },
  ...{ twoSidedBias: 1, perTile: 128, scatterTiles: true, compactTiles: true },
  ...{ subsampleDepth: false, transmission: true, snapTexels: 2040 },
}

/** The uniform of `light` seen from `eye` (metres) under `settings`, and the cascade's bounds. */
export function placed(eye: number[], light: DfshLight = SUN, settings: DfshSettings = SETTINGS) {
  const image = camera(eye)
  const bounds = boundsOf(image, light)
  const floats = new Float32Array(DFSH_PARAMS_STRIDE / 4)
  const words = new Uint32Array(floats.buffer)
  writeDfshParams(floats, words, 0, { image, light, bounds, layer: 0 }, settings, { objects: 1 })
  return { bounds, floats }
}
