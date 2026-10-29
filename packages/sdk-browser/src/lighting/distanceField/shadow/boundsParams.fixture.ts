// What the suns' mesh lists tests share (`boundsParams.test.ts`, `boundsPlacement.test.ts`): a
// sun, the settings and the uniform a sun is placed in.
import assert from 'node:assert/strict'
import { boxBounds } from './bounds.ts'
import { DFSH_PARAMS_STRIDE } from './layout.ts'
import { writeDfshParams, type DfshSettings } from './params.ts'

export const near = (a: number, b: number, why: string, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${why}: ${a} against ${b}`)
export const dot = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The direction toward a sun straight over the volume. */
export const SUN: readonly [number, number, number] = [0, 1, 0]

export const SETTINGS: DfshSettings = {
  ...{ quality: 3, tileSize: 2, twoSidedBias: 1 },
  ...{ perTile: 128, compactTiles: true, snapTexels: 2040 },
}

/** The uniform of the sun `toLight` seen from `eye` (metres) under `settings`, for the cube of half side `half` metres about the eye, and the volume's bounds. */
export function placed(
  eye: number[],
  toLight: readonly [number, number, number] = SUN,
  settings: DfshSettings = SETTINGS,
  half = 100,
) {
  const bounds = boxBounds([0, 0, 0], half, toLight)
  const floats = new Float32Array(DFSH_PARAMS_STRIDE / 4)
  const words = new Uint32Array(floats.buffer)
  writeDfshParams(floats, words, 0, { eye, toLight, bounds }, settings, { objects: 1 })
  return { bounds, floats }
}
