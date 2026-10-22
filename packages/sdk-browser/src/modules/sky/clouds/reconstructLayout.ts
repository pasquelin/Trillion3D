import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { wgslBlock, wgslConst } from '../../../../../math/src/wgsl/decl.ts'
import type { FieldType } from '../../../gpu/core/fieldLayout.ts'
import { CLOUD_MODES, type CloudMode, type TargetSize } from './cloudModes.ts'

/**
 * WHAT THE CLOUDS' IMAGE IS MADE OF, the one table the tracing, the reconstruction and the
 * composition read: the sizes of the traced and the reconstructed images, which the mode
 * (`cloudModes.ts`) gives (in mode 0 the traced image is a quarter of the view's size per axis, one
 * pixel in sixteen, the reconstructed image half of it), and the cycle over the images that says
 * which pixel of a traced texel's block is the one traced now.
 *
 * Three images are traced in mode 0 (two surfaces), two in the others, each as a texture of its own:
 * - `colour`: the cloud's luminance in `rgb`, its transmittance in `a`;
 * - `secondary`: the same, for the closest surface of the texel's depth range;
 * - `depth`, in kilometres from the eye: `x` the cloud's front, `y` the scene's
 *   depth the ray was cut at (the furthest), `z` the closest and `w` the furthest depth of the
 *   texel's range of scene depths.
 * The reconstruction writes the same, at its size; the one it wrote the image before is its
 * history. A reconstructed image is alternately the destination and the history. Modes 1 and 3 have
 * no reconstructed image: the composition reads the traced one.
 */

/** A size in texels. */
export type Size = TargetSize

/** The three images' format: four half floats. */
export const CLOUD_FORMAT: GPUTextureFormat = 'rgba16float'

/** A size divided by `by` per axis, rounding up. */
export const dividedSize = (size: Size, by: number): Size => ({
  width: ceilDiv(size.width, by),
  height: ceilDiv(size.height, by),
})

/** An image's texture, and the part of it the view fills: the texture is made for the largest view,
 *  and keeps its size while the view's changes. */
export interface ImageSize {
  readonly texture: Size
  readonly view: Size
}

/** The sizes of the traced and the reconstructed images of `mode` (mode 0 by default), for a view
 *  of `view` pixels drawn in a target allocated at `allocated`, both already on the target's scale:
 *  each divides the one before, rounding up. */
export function cloudSizes(allocated: Size, view: Size, mode: CloudMode = CLOUD_MODES[0]) {
  const reconstructedTexture = dividedSize(allocated, mode.reconstructDownsample)
  const reconstructedView = dividedSize(view, mode.reconstructDownsample)
  return {
    reconstructed: { texture: reconstructedTexture, view: reconstructedView } as ImageSize,
    traced: {
      texture: dividedSize(reconstructedTexture, mode.traceDownsample),
      view: dividedSize(reconstructedView, mode.traceDownsample),
    } as ImageSize,
  }
}

/** Four words into `out` at `at`: the one way every uniform of the clouds' passes is
 *  written, by index, no array made. */
export function put4(
  out: Float32Array | Uint32Array,
  at: number,
  x: number,
  y: number,
  z: number,
  w: number,
) {
  out[at] = x
  out[at + 1] = y
  out[at + 2] = z
  out[at + 3] = w
}

/** The bounds an image's reads keep to, so that a filtered read never reaches past the part of the
 *  texture the view fills: eight floats, the last texel to load (`coordRect`) and the range of
 *  coordinates to sample (`uvRect`, half a texel and a hundredth in). One field of a uniform
 *  (`ImageBounds` in `BOUNDED_READ_WGSL`), written by `writeSafeBounds`. */
export const BOUNDS_FIELD: FieldType = { wgsl: 'ImageBounds', words: 8, align: 4 }

/** The bounds of `image` into `out` at `at` (`BOUNDS_FIELD`). */
export function writeSafeBounds(out: Float32Array, at: number, image: ImageSize) {
  const { texture, view } = image
  put4(out, at, 0, 0, view.width - 1, view.height - 1)
  put4(
    out,
    at + 4,
    0.51 / texture.width,
    0.51 / texture.height,
    (view.width - 0.51) / texture.width,
    (view.height - 0.51) / texture.height,
  )
}

/** The scale from the view's to the texture's coordinates, into `out` at `at` and the next word. */
export function writeViewScale(out: Float32Array, at: number, image: ImageSize) {
  out[at] = image.view.width / image.texture.width
  out[at + 1] = image.view.height / image.texture.height
}

/** The device depth under which a depth is not read: a point at the far plane of a reverse-Z
 *  projection, kept off zero. */
export const DEVICE_DEPTH_FLOOR = wgslConst(
  'DEVICE_DEPTH_FLOOR',
  [],
  'const DEVICE_DEPTH_FLOOR:f32=0.000000000001;',
)

/** The reads of an image through its bounds, shared by the reconstruction and the composition: a
 *  texel loaded and a point sampled, linear and clamped (`linearSampler`, which the program binds),
 *  both kept inside the part of the texture the view fills. */
export const BOUNDED_READ_WGSL = wgslBlock(
  'BOUNDED_READ_WGSL',
  [],
  `struct ImageBounds{coordRect:vec4f,uvRect:vec4f,}
fn loadBounded(t:texture_2d<f32>,b:ImageBounds,c:vec2i)->vec4f{
 return textureLoad(t,clamp(c,vec2i(b.coordRect.xy),vec2i(b.coordRect.zw)),0);
}
fn sampleBounded(t:texture_2d<f32>,b:ImageBounds,uv:vec2f)->vec4f{
 return textureSampleLevel(t,linearSampler,clamp(uv,b.uvRect.xy,b.uvRect.zw),0.0);
}`,
)

/** The linear, clamped sampler the reconstruction and the composition read the images through. */
export const RECONSTRUCT_SAMPLER: GPUSamplerDescriptor = {
  label: 'Trillion3D cloud reconstruction',
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
}

/**
 * The offset the traced image's rays are shifted by, in normalised device coordinates, so that
 * the ray of a traced texel passes through the centre of the reconstructed pixel `offset` names,
 * into `out` at `at` (two words). The view's own anti-aliasing jitter is removed first; this one
 * replaces it. `reconstructed` is the reconstructed image's view; the centre is that of a
 * reconstructed pixel's own size, whatever the mode.
 */
export function writeTracingJitter(
  out: Float32Array,
  at: number,
  offset: readonly [number, number],
  reconstructed: Size,
  mode: CloudMode,
) {
  const centre = mode.reconstructDownsample / 2
  out[at] = ((offset[0] + 0.5 - centre) * -2) / reconstructed.width
  out[at + 1] = ((offset[1] + 0.5 - centre) * 2) / reconstructed.height
}
