// A synthetic still frame for the reflection proofs (`rig.ts`): what the engine's targets hold, as
// arrays of the image's pixels.
import { toHalf } from '../../../packages/math/src/float/half.ts'
import type { RigFace } from './rigRuntime.ts'

/** A synthetic still frame of `size` pixels: what the engine's targets hold, as arrays of the
 *  image's pixels, `normals`, `base` and `radiance` four floats each (the normal and the roughness,
 *  the colour and the metalness, the lit colour and its coverage). */
export type RigFrame = {
  size: readonly [number, number]
  viewProjection: Float64Array
  eye: readonly [number, number, number]
  depth: Float32Array<ArrayBuffer>
  flags: Uint8Array<ArrayBuffer>
  normals: Float32Array
  base: Float32Array
  radiance: Float32Array
  /** The physical lobes' texel of every pixel, four words each (`physicalTexel`), for a frame
   *  whose pixels carry them (`PHYSICAL_SURFACE_FLAG`). */
  lobes?: Uint32Array<ArrayBuffer>
  /** The proxy of the scene: its faces, two triangles each, and the radiance each gives (`rigRuntime.ts`). */
  proxy?: { faces: RigFace[] }
  /** The background, `0xrrggbb`, as the display shows it: black by default. */
  background?: number
  /** The irradiance of a light declared around the scene: nine RGB coefficients, 27 numbers
   *  (`SceneEnvironment.irradiance`); none by default. */
  environment?: readonly number[]
}

export const halves = (values: ArrayLike<number>) => Uint16Array.from(values, toHalf)

/** The half-float word of a not-a-number: what a pixel the trace leaves unwritten keeps. */
export const HALF_NAN = 0x7e00
