import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { IRRADIANCE_TERMS } from '../../../../sdk-core/src/scene/core/irradianceTerms.ts'

/**
 * THE VOLUMETRIC LIGHTMAP'S SAMPLING: where a world position lies in the atlas of bricks, and the
 * light stored there (`../../../../sdk-core/src/lighting/volumetricLightmapFile.ts`).
 *
 * A position clamps into the volume (at most 0.99 of its size, so the last texel is never
 * crossed), reads its indirection texel — the brick's place in the atlas, `.xyz`, and how many
 * finest bricks it spans, `.w` — and lands in the brick at the fraction of the span it lies at;
 * the padded bricks are `brickSize + 1` wide and the half texel centres the read on a sample. The
 * atlas is then read trilinearly at that place, `vlmBrickUvs`. Spherical harmonics come back as the
 * ambient (the zeroth coefficient) beside the others, which the file stores divided by the ambient
 * and by the basis function's scale and mapped to [0, 1]: they are mapped back to [-1, 1] and the
 * ambient and the scales put back. The sky's bent normal is mapped back too, its length the sky's
 * visibility.
 *
 * A view block of zeros (no lightmap, or hidden) answers black from every function: the first
 * returns the origin of the black one-texel textures that are bound then (`textures.ts`).
 * The bent normal of a lightmap without one reads (-1, -1, -1) from that black, as black does
 * in the reference: whoever reads it asks for static shadowing only where the sky light wants it.
 *
 * The bindings are consecutive from `first` in the bind group `group`: the view block, the
 * sampler, the indirection volume (a read-only storage texture, read by load alone: it spends none
 * of a stage's sixteen sampled textures), the ambient, the six coefficient layers (red low, red high, green
 * low, green high, blue low, blue high), the bent normal.
 */

/** The harmonics' scale of term `k` as the file stores it, from the basis table. */
const termScale = (k: number) => Math.abs(IRRADIANCE_TERMS[k].contract)

const SH_SCALE = termScale(0)

const SAMPLE_LIGHT = `
fn vlmAmbient(uv:vec3f)->vec3f{return textureSampleLevel(vlmAmbientTexture,vlmSampler,uv,0.0).xyz;}
fn vlmSh1(uv:vec3f)->VlmSh1{
 let a=vlmAmbient(uv);
 return VlmSh1(a.x,a.y,a.z);
}
struct VlmLow{ambient:vec3f,red:vec4f,green:vec4f,blue:vec4f}
fn vlmLowCoefficients(uv:vec3f)->VlmLow{
 let a=vlmAmbient(uv);
 let scales=vec4f(${termScale(1)}/${SH_SCALE},${termScale(2)}/${SH_SCALE},${termScale(3)}/${SH_SCALE},${termScale(4)}/${SH_SCALE});
 let r=(textureSampleLevel(vlmCoefficients0,vlmSampler,uv,0.0)*2.0-1.0)*a.x*scales;
 let g=(textureSampleLevel(vlmCoefficients2,vlmSampler,uv,0.0)*2.0-1.0)*a.y*scales;
 let b=(textureSampleLevel(vlmCoefficients4,vlmSampler,uv,0.0)*2.0-1.0)*a.z*scales;
 return VlmLow(a,r,g,b);
}
fn vlmSh2(uv:vec3f)->VlmSh2{
 let l=vlmLowCoefficients(uv);
 return VlmSh2(vec4f(l.ambient.x,l.red.xyz),vec4f(l.ambient.y,l.green.xyz),vec4f(l.ambient.z,l.blue.xyz));
}
fn vlmSh3(uv:vec3f)->VlmSh3{
 let l=vlmLowCoefficients(uv);
 let scales=vec4f(${termScale(5)}/${SH_SCALE},4.0*${termScale(6)}/${SH_SCALE},${termScale(7)}/${SH_SCALE},2.0*${termScale(8)}/${SH_SCALE});
 let r=(textureSampleLevel(vlmCoefficients1,vlmSampler,uv,0.0)*2.0-1.0)*l.ambient.x*scales;
 let g=(textureSampleLevel(vlmCoefficients3,vlmSampler,uv,0.0)*2.0-1.0)*l.ambient.y*scales;
 let b=(textureSampleLevel(vlmCoefficients5,vlmSampler,uv,0.0)*2.0-1.0)*l.ambient.z*scales;
 return VlmSh3(
  vec4f(l.ambient.x,l.red.xyz),vec4f(l.red.w,r.xyz),r.w,
  vec4f(l.ambient.y,l.green.xyz),vec4f(l.green.w,g.xyz),g.w,
  vec4f(l.ambient.z,l.blue.xyz),vec4f(l.blue.w,b.xyz),b.w);
}
fn vlmSkyBentNormal(uv:vec3f)->vec3f{return textureSampleLevel(vlmSkyBentNormalTexture,vlmSampler,uv,0.0).xyz*2.0-1.0;}`

/** The dot of an SH projection with a basis: the light's colour along it, band by band. */
const DOTS = `
fn vlmDotSh1(sh:VlmSh1,basis:f32)->vec3f{return vec3f(sh.r,sh.g,sh.b)*basis;}
fn vlmDotSh2(sh:VlmSh2,basis:vec4f)->vec3f{return vec3f(dot(sh.r,basis),dot(sh.g,basis),dot(sh.b,basis));}
fn vlmDotSh3(sh:VlmSh3,low:vec4f,high:vec4f,top:f32)->vec3f{
 return vec3f(
  dot(sh.r0,low)+dot(sh.r1,high)+sh.r2*top,
  dot(sh.g0,low)+dot(sh.g1,high)+sh.g2*top,
  dot(sh.b0,low)+dot(sh.b1,high)+sh.b2*top);
}`

const LOOKUP = `
fn vlmBrickUvs(worldPosition:vec3f)->vec3f{
 if(vlmView.scale.w==0.0){return vec3f(0.0);}
 let volumeUvs=clamp(worldPosition*vlmView.scale.xyz+vlmView.offset.xyz,vec3f(0.0),vec3f(0.99));
 let texel=volumeUvs*vlmView.indirectionSize.xyz;
 let brick=vec4f(textureLoad(vlmIndirection,vec3i(texel)));
 let padded=vlmView.scale.w+1.0;
 return (brick.xyz*padded+fract(texel/brick.w)*vlmView.scale.w+0.5)*vlmView.texelSize.xyz;
}`

const STRUCTS = `
struct VlmView{scale:vec4f,offset:vec4f,indirectionSize:vec4f,texelSize:vec4f}
struct VlmSh1{r:f32,g:f32,b:f32}
struct VlmSh2{r:vec4f,g:vec4f,b:vec4f}
struct VlmSh3{r0:vec4f,r1:vec4f,r2:f32,g0:vec4f,g1:vec4f,g2:f32,b0:vec4f,b1:vec4f,b2:f32}`

/** The declarations of the bindings from `first` in bind group `group`. */
const declarations = (group: number, first: number) =>
  [
    'var<uniform> vlmView:VlmView',
    'var vlmSampler:sampler',
    'var vlmIndirection:texture_storage_3d<rgba8uint,read>',
    'var vlmAmbientTexture:texture_3d<f32>',
    ...[0, 1, 2, 3, 4, 5].map((k) => `var vlmCoefficients${k}:texture_3d<f32>`),
    'var vlmSkyBentNormalTexture:texture_3d<f32>',
  ]
    .map((text, k) => `@group(${group}) @binding(${first + k}) ${text};`)
    .join('\n')

/** The lightmap's sampling for a program that binds it in `group` from binding `first`
 *  (eleven of them): `vlmBrickUvs` the position's place in the atlas,
 *  `vlmSh1`, `vlmSh2` and `vlmSh3` the light there in one to three bands, `vlmSkyBentNormal` the
 *  sky's stored shadowing, and the dots `vlmDotSh1`, `vlmDotSh2` and `vlmDotSh3` of a projection
 *  with a basis. */
export const volumetricLightmapWgsl = (group: number, first: number) =>
  wgslBlock(
    `volumetricLightmapWgsl(${group}, ${first})`,
    [],
    `${STRUCTS}\n${declarations(group, first)}${LOOKUP}${SAMPLE_LIGHT}${DOTS}`,
  )
