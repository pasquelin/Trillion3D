import { EMISSIVE_AO_SURFACE_FLAG } from './surfaceModel.ts';
import type { VisMaterial } from '../visibility/materialType.ts';

/**
 * THE EMISSION-AND-OCCLUSION TEXEL, READ ONLY WHERE IT HOLDS SOMETHING (#1369).
 *
 * A pixel fetches only what its shading model reads: a field most
 * pixels leave at its default is not fetched there. Here the surface buffer's normal stays in
 * `rgba16float` — three half floats that no two-channel octahedral code gives back bit for bit —
 * and its roughness and metalness already ride in the alpha of the normal and the base colour. What
 * the lit pixel fetched with nothing in it is the third target: emission (RGB) and ambient occlusion
 * (A), `(0, 0, 0, 1)` on a surface that neither emits nor has an occlusion map. A spare bit of the
 * flags target, which every reader already loads, marks the texels that differ from it; the resolve
 * loads the texel under that bit only, and elsewhere takes the constant the texel holds.
 *
 * Exact by construction: on a surface the resolve lights or shows unlit, the bit is clear only where
 * the written emission's three words are zero — `bitcast`, so a negative zero or a NaN sets it — and
 * the occlusion is exactly one; the half float target stores such a texel as `(0, 0, 0, 1)` bit for
 * bit. Every other value, one the conversion flushes to zero included, is fetched as before. An
 * as-is surface (`AS_IS_FLAG`, a debug view) never carries the bit, keeping its flag whole: nothing
 * reads its occlusion, and its emission is zero.
 */

/** The bit a surface written with `emissive` and `ao` carries (the material pass). `EMISSIVE_AO`
 *  false — an image without the layer (`surfaceEmitsOrOccludes`) — marks no texel: none of its
 *  surfaces could have set the bit. */
export const EMISSIVE_AO_FLAG_WGSL = `
override EMISSIVE_AO:bool=true;
fn emissiveAoFlag(emissive:vec3f,ao:f32)->u32{return select(0u,${EMISSIVE_AO_SURFACE_FLAG}u,EMISSIVE_AO&&(any(bitcast<vec3u>(emissive)!=vec3u(0u))||ao!=1.0));}`;

/** Bytes a pixel of the emission-and-occlusion layer takes (`rgba16float`). */
export const EMISSIVE_AO_BYTES = 8;

/** The f32 bits of `x` are not all zero: a negative zero and a NaN count, as the GPU compares bits;
 *  a value the conversion flushes to zero counts too, which only keeps the layer. */
const bitsSet = (x: number) => x !== 0 || Object.is(x, -0);

/**
 * Whether a surface can write a texel other than `(0, 0, 0, 1)`, the one `emissiveAoFlag` leaves
 * unmarked: an emission or occlusion map, an emission factor of any bit set, or an occlusion
 * intensity whose product with zero is no zero (`1 + intensity × 0`, an infinite or a NaN). An
 * image none of whose opaque surfaces can has no use for the layer: nothing marks a texel of it.
 */
export function surfaceEmitsOrOccludes(
  mat: Pick<VisMaterial, 'emissive' | 'emissiveMap' | 'aoMap' | 'aoIntensity'>,
) {
  const [r, g, b] = mat.emissive;
  return (
    !!mat.emissiveMap ||
    !!mat.aoMap ||
    bitsSet(r) ||
    bitsSet(g) ||
    bitsSet(b) ||
    !Number.isFinite(Math.fround(mat.aoIntensity))
  );
}

/** The pixel's emission and occlusion: the texel under the bit, `(0, 0, 0, 1)` without it. Needs
 *  the pass's `emissiveAo` binding. */
export const SURFACE_EMISSIVE_AO_WGSL = `
fn surfaceEmissiveAo(coord:vec2i,surfaceFlag:u32)->vec4f{
 if((surfaceFlag&${EMISSIVE_AO_SURFACE_FLAG}u)==0u){return vec4f(0.0,0.0,0.0,1.0);}
 return textureLoad(emissiveAo,coord,0);
}`;
