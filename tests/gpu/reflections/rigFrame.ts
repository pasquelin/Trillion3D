// A synthetic still frame for the reflection proofs (`rig.ts`): what the engine's targets hold, as
// arrays of the image's pixels.
import { toHalf } from '../../../packages/math/src/float/half.ts'
import type { RigFace } from './rigRuntime.ts'
import type { Camera, V3 } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { REFLECTION_CONSTANTS } from '../../../packages/sdk-browser/src/reflections/constants.ts'

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
  /** The background, `0xrrggbb`, as the display shows it: black by default. A ray that leaves the
   *  scene reaches it (`createSurroundings`). */
  background?: number
  /** The irradiance of a light declared around the scene: nine RGB coefficients, 27 numbers
   *  (`SceneEnvironment.irradiance`); none by default. */
  environment?: readonly number[]
}

/** A frame of `size` pixels seen through `viewProjection` from `eye`, every pixel empty: no depth,
 *  no surface, zero normals, base and radiance. Its builders fill the pixels they show. */
export function rigFrameOf(
  size: readonly [number, number],
  viewProjection: Float64Array,
  eye: readonly [number, number, number],
): RigFrame {
  const pixels = size[0] * size[1]
  return {
    size,
    viewProjection,
    eye,
    depth: new Float32Array(pixels),
    flags: new Uint8Array(pixels),
    normals: new Float32Array(pixels * 4),
    base: new Float32Array(pixels * 4),
    radiance: new Float32Array(pixels * 4),
  }
}

export const halves = (values: ArrayLike<number>) => Uint16Array.from(values, toHalf)

/** The half-float word of a not-a-number: what a pixel the trace leaves unwritten keeps. */
export const HALF_NAN = 0x7e00

/** Whether the world point `point`, reflected at pixel `p`, lies on the image, off its border
 *  (`REFLECTION_EDGE` of its height), within half of the distance the march covers
 *  (`REFLECTION_STEP_CAP`): the screen can answer it. Returns its pixel, or undefined. */
export function pointOnScreen(view: Camera, point: V3, p: number): [number, number] | undefined {
  const [hx, hy] = view.project(point)
  const border = REFLECTION_CONSTANTS.REFLECTION_EDGE * view.height
  if (hx <= border || hy <= border || hx >= view.width - border || hy >= view.height - border)
    return undefined
  const away =
    Math.abs(hx - (p % view.width) - 0.5) + Math.abs(hy - Math.floor(p / view.width) - 0.5)
  return away >= REFLECTION_CONSTANTS.REFLECTION_STEP_CAP / 2 ? undefined : [hx, hy]
}
