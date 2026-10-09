// A synthetic still frame for the reflection proofs (`rig.ts`): what the engine's targets hold, as
// arrays of the image's pixels.
import { toHalf } from '../../../packages/math/src/float/half.ts'
import type { SceneProxy } from '../../../packages/sdk-core/src/index.ts'

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
  /** The resident proxy of the scene, and the radiance of its surfaces: one texel a face of each
   *  triangle, the two faces of a triangle after one another (`SURFACE_RAY_WGSL`), four floats
   *  each. `reach` is how far a ray traces it, in metres. */
  proxy?: { scene: SceneProxy; surface: Float32Array<ArrayBuffer>; reach: number }
  /** The background, `0xrrggbb`, as the display shows it: black by default. */
  background?: number
}

export const halves = (values: ArrayLike<number>) => Uint16Array.from(values, toHalf)

/** The half-float word of a not-a-number: what a pixel the trace leaves unwritten keeps. */
export const HALF_NAN = 0x7e00
