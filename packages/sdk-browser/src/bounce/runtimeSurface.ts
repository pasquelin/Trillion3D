import { composesWithBackground } from '../scene/materialBlending.ts'
import type { PageSurface } from '../page/surface.ts'
import { saturate } from '../../../math/src/scalar/reals.ts'
import { SURFACE_BLENDED, SURFACE_WORDS } from './runtimeLayout.ts'

/**
 * A surface's words in the run-time proxy (`runtimeLayout.ts`), from the record the engine holds of
 * it (`PageSurface`, refilled in place when the host edits the material): its diffuse tint (the base
 * colour a metal does not scatter), its opacity, the radiance it emits and whether it is blended. An
 * unlit surface shows its colour as it is: its emission. A map is a texture a ray cannot sample from
 * the proxy: the factor stands for it, the average the cooked proxy takes of it (`proxy/albedo.rs`) being
 * the cut's of a texture it has no preview of.
 */
export function writeSurface(words: Uint32Array, at: number, surface: PageSurface) {
  const floats = new Float32Array(words.buffer, words.byteOffset + at * 4, SURFACE_WORDS)
  const [r, g, b] = surface.baseColor,
    scattered = surface.lit ? 1 - saturate(surface.metalness) : 0,
    [er, eg, eb] = surface.lit ? surface.emissive : surface.baseColor
  floats.set([r * scattered, g * scattered, b * scattered, saturate(surface.opacity), er, eg, eb])
  const blended =
    surface.transparent ||
    (surface.blending !== undefined && composesWithBackground(surface.blending))
  words[at + 7] = blended ? SURFACE_BLENDED : 0
}
