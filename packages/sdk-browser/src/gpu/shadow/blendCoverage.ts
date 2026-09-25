import { FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_SAMPLED } from '../../visibility/types.ts';
import type { PageSurface } from '../../page/surface.ts';

/**
 * The shadow of a blended surface. The shadow pool keeps one depth per texel, so a surface that
 * lets a share of the light through cannot store "half a depth": it stores its depth on the share
 * of the texels its coverage names, and the far depth behind it on the others. The PCF of the read
 * (`../../lighting/direct/shadowWgsl.ts`, sixteen taps a texel apart) averages that pattern back
 * into a partial shadow. One depth per texel, one raster, one filter: nothing the opaque path does
 * not already do.
 *
 * The pattern is a 4×4 ordered (Bayer) matrix on the map's own texels: the pool's pages and the
 * virtual pages are multiples of four texels, so a page drawn again, anywhere in the pool, keeps
 * the same texels. It is not temporal: shadow pages are kept from one image to the next, and no
 * temporal pass averages them.
 *
 * Coverage 0 keeps no texel, coverage 1 keeps all sixteen — the opaque depth, to the bit.
 */
export const BLEND_DITHER: readonly number[] = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
]
  // Each rank's threshold sits in the middle of its sixteenth: `coverage > threshold` keeps
  // `round(16 × coverage)` texels of every 4×4 block.
  .map((rank) => (rank + 0.5) / 16);

/**
 * True when a blended surface casts at all: drawn over what is behind it (normal blending), not
 * transmissive, and stopping some light. An additive surface adds light and stops none; a
 * transmissive one tints what crosses it, which a depth cannot say — its coloured shadow is #33's,
 * which can extend the coverage word into a transmittance. A fully transparent one stops nothing:
 * none of them takes a caster row.
 */
export const castsBlendShadow = (surface: PageSurface) =>
  surface.blending === 'normal' && !(surface.transmission > 0) && surface.opacity > 0;

/** Share of the light a blended surface stops, before its colour map's alpha: its opacity. */
export const blendCoverage = (surface: PageSurface) => Math.min(1, Math.max(0, surface.opacity));

/**
 * The texel test of a blended caster in the shadow depth pass: its coverage times its colour map's
 * alpha, read like the cutout's (`maskAlpha`, `../../webgpu/tile/wgsl.ts`), against the texel's
 * threshold. Requires `PageInfo` and `maskAlpha`.
 */
export const BLEND_COVERAGE_WGSL = `const BLEND_DITHER:array<f32,16>=array<f32,16>(${BLEND_DITHER.join(',')});
fn blendCasterKeep(page:PageInfo,uv:vec2f,ddx:vec2f,ddy:vec2f,texel:vec2f)->bool{
 var alpha=page.blendCoverage;
 if((page.flags&${FLAG_HAS_UV | FLAG_HAS_MAP}u)==${FLAG_HAS_UV | FLAG_HAS_MAP}u){alpha*=maskAlpha(page.mapIndex,uv,ddx,ddy,(page.flags&${FLAG_SAMPLED}u)!=0u);}
 let p=vec2u(texel)&vec2u(3u);
 return alpha>BLEND_DITHER[p.y*4u+p.x];
}`;
