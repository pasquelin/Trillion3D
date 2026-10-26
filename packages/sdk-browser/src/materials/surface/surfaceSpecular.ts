import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE SPECULAR OF A SURFACE, per pixel: a dielectric reflects 0.08 × its specular at normal
 * incidence (`surfaceF0`), 0.04 at the default 0.5 — the constant every surface that gives none
 * keeps (`DIELECTRIC_F0`, the exact same number). Only a graph that wires the `specular` output
 * gives one: the opaque resolve leaves it in the surface flags' second byte
 * (`SPECULAR_SHIFT`), `specularFlag` — one more than its code of 254 steps, so that zero says none
 * was given — and the lighting reads it back (`specularOfFlags`), the transparent pass taking it
 * from the graph itself. A program sets `surfaceSpecular` once a pixel, before it lights it
 * (`lobeSurface`, the reflections' weight read `surfaceF0`); a program that never sets it keeps 0.5.
 */
const SPECULAR_SHIFT = 8
/** The bits of the surface flags the specular occupies. */
export const SPECULAR_FLAG_MASK = 255 << SPECULAR_SHIFT

/** The surface flags' byte of a specular written as `specular`: its code, one past zero. */
export const specularFlag = wgslFn(
  'specularFlag',
  [],
  `fn specularFlag(specular:f32)->u32{return (1u+u32(round(saturate(specular)*254.0)))<<${SPECULAR_SHIFT}u;}`,
)

/** The specular the flags word `flags` of a surface holds: the default 0.5 where none was given. */
export const specularOfFlags = wgslFn(
  'specularOfFlags',
  [],
  `fn specularOfFlags(flags:u32)->f32{
 let code=(flags>>${SPECULAR_SHIFT}u)&255u;
 return select(0.5,(f32(code)-1.0)/254.0,code!=0u);
}`,
)

/** The pixel's specular, and the reflectance of a surface of colour `rgb` and metalness `metal` that has
 *  it: the dielectric's 0.08 × specular, the colour where it is metal. */
export const SURFACE_F0_WGSL = wgslBlock(
  'SURFACE_F0_WGSL',
  [],
  `var<private> surfaceSpecular:f32=0.5;
fn surfaceF0(rgb:vec3f,metal:f32)->vec3f{
 return mix(vec3f(0.08*surfaceSpecular),rgb,metal);
}`,
)
