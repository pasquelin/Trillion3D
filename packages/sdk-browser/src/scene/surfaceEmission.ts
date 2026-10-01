import { EMISSIVE_AO_SURFACE_FLAG } from './surfaceModel.ts';

/**
 * THE EMISSION-AND-OCCLUSION TEXEL, READ ONLY WHERE IT HOLDS SOMETHING (#1369).
 *
 * the reference engine packs its GBuffer so that a pixel fetches only what its shading model reads: a field most
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

/** The bit a surface written with `emissive` and `ao` carries (the material pass). */
export const EMISSIVE_AO_FLAG_WGSL = `
fn emissiveAoFlag(emissive:vec3f,ao:f32)->u32{return select(0u,${EMISSIVE_AO_SURFACE_FLAG}u,any(bitcast<vec3u>(emissive)!=vec3u(0u))||ao!=1.0);}`;

/** The pixel's emission and occlusion: the texel under the bit, `(0, 0, 0, 1)` without it. Needs
 *  the pass's `emissiveAo` binding. */
export const SURFACE_EMISSIVE_AO_WGSL = `
fn surfaceEmissiveAo(coord:vec2i,surfaceFlag:u32)->vec4f{
 if((surfaceFlag&${EMISSIVE_AO_SURFACE_FLAG}u)==0u){return vec4f(0.0,0.0,0.0,1.0);}
 return textureLoad(emissiveAo,coord,0);
}`;
