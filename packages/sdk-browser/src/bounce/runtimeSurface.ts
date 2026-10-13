import { composesWithBackground } from '../scene/materialBlending.ts'
import type { PageSurface } from '../page/surface.ts'
import { saturate } from '../../../math/src/scalar/reals.ts'
import { SURFACE, SURFACE_BLENDED, SURFACE_WORDS } from './runtimeLayout.ts'

/**
 * A surface's words in the run-time proxy (`runtimeLayout.ts`), from the record the engine holds of
 * it (`PageSurface`, refilled in place when the host edits the material): its diffuse tint (the base
 * colour a metal does not scatter), its opacity, the radiance it emits and whether it is blended. An
 * unlit surface shows its colour as it is: its emission. A map is a texture a ray cannot sample from
 * the proxy: the factor stands for it in a cut the world made, the average the compiler took of it
 * (`proxy/albedo.rs`) in a compiled mesh (`tint`).
 */
export function writeSurface(words: Uint32Array, at: number, surface: PageSurface, tint?: number) {
  const floats = new Float32Array(words.buffer, words.byteOffset + at * 4, SURFACE_WORDS)
  const [r, g, b] = surface.baseColor,
    scattered = surface.lit ? 1 - saturate(surface.metalness) : 0,
    [er, eg, eb] = surface.lit ? surface.emissive : surface.baseColor
  // A compiled mesh brings its own tint, the compiler's: the material's colour with the average of its
  // texture, and without the share a metal does not scatter (`proxy/albedo.rs`).
  const diffuse =
    tint === undefined || !surface.lit
      ? [r * scattered, g * scattered, b * scattered]
      : [tint & 255, (tint >>> 8) & 255, (tint >>> 16) & 255].map((byte) => byte / 255)
  floats.set(diffuse, SURFACE.tint)
  floats[SURFACE.opacity] = saturate(surface.opacity)
  floats.set([er, eg, eb], SURFACE.emission)
  const blended =
    surface.transparent ||
    (surface.blending !== undefined && composesWithBackground(surface.blending))
  words[at + SURFACE.flags] = blended ? SURFACE_BLENDED : 0
}
