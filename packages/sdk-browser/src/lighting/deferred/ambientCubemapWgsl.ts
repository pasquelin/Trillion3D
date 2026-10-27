import { PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { DIELECTRIC_F0, lambertDiffuse, slabF90 } from '../../../../math/src/wgsl/lighting.ts'
import { AMBIENT_CUBEMAP_DIFFUSE_MIP } from '../../../../sdk-core/src/lighting/ambientCubemapMips.ts'
import { ENVIRONMENT_BRDF_WGSL } from '../direct/environmentBrdfWgsl.ts'
import { ENVIRONMENT_LIGHTING_WGSL } from '../direct/lightingWgsl.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'

/**
 * THE AMBIENT CUBEMAP, A SECOND SOURCE OF THE INDIRECT PASS (`indirectPassWgsl.ts` lists it where the image sets a cube): the cube
 * of the host's, its mip chain filtered by angle (`ambientCubemapFrame.ts`), read as the two lights the environment gives a surface
 * and weighed by the same sums, so that every lobe takes it — the cloth's fuzz, the clear coat, a thin surface's back.
 * - The diffuse light: the cube along the normal at the mip `AMBIENT_CUBEMAP_DIFFUSE_MIP` above the last, where it holds the cube
 *   convolved by the whole hemisphere, as the irradiance of the environment's sum (`environmentLightingFrom`), under the occlusion
 *   the environment's takes; a thin surface's back reads it along the opposite normal.
 * - The specular light: the cube along the direction the reflection is pointed at (`offSpecularPeakDirection`: the reflection
 *   drawn toward the normal as the roughness widens the lobe) at the mip the roughness picks (`cubemapMipFromRoughness`), weighed
 *   by the preintegrated environment BRDF on the reflectance of the surface (`indirectF0`) and its grazing value `slabF90`, the slab
 *   environment's own, and, under a clear coat, the layers' combination: the base lobe under what the coat lets through, and the
 *   coat's own lobe on its normal and roughness. It takes no occlusion: the cube's specular is not occluded.
 * Both are times the cube's colour (`ambientCubeColour`: the tint times the intensity, with the unit the cube was fitted to a half
 * float by).
 *
 * The program that lists it lists the host's lighting (`clothDiffuse`, `indirectF0`, `indirectKeep`, `thinSurface`).
 */

/** The cube, the sampler it is read through and its colour, in group 0. */
const AMBIENT_CUBEMAP_BINDING_WGSL = wgslBlock(
  'AMBIENT_CUBEMAP_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.ambientCube}) var ambientCube:texture_cube<f32>;
@group(0) @binding(${DEFERRED_BINDINGS.ambientCubeSampler}) var ambientCubeSampler:sampler;
@group(0) @binding(${DEFERRED_BINDINGS.ambientCubeColour}) var<uniform> ambientCubeColour:vec4f;`,
)

/** The mip of a cube of `mipCount` mips a reflection of roughness `roughness` is read at: three mips above the last (the one texel mip)
 *  at a roughness of one, and 1.15 mips finer for every halving of the roughness, the roughness held to 0.001 so that a mirror
 *  reads the finest mip, not the infinite one. */
export const cubemapMipFromRoughness = wgslFn(
  'cubemapMipFromRoughness',
  [],
  'fn cubemapMipFromRoughness(roughness:f32,mipCount:f32)->f32{return mipCount-1.0-(3.0-1.15*log2(max(roughness,0.001)));}',
)

/** The direction a reflection is read along: the reflection `R` of the normal `N`, drawn toward the normal as the roughness
 *  widens the lobe, by `(1 - a)(√(1 - a) + a)` with `a` the roughness squared. */
export const offSpecularPeakDirection = wgslFn(
  'offSpecularPeakDirection',
  [],
  `fn offSpecularPeakDirection(N:vec3f,R:vec3f,roughness:f32)->vec3f{
 let a=roughness*roughness;
 return mix(N,R,(1.0-a)*(sqrt(1.0-a)+a));
}`,
)

/** The statements of the clear coat's layers over the base lobe's weighed radiance `base`, in a program that holds the lobes: the base
 *  lobe weighed on what the coat leaves of its grazing part and lets through, the coat's own lobe, read along its normal at its
 *  roughness, weighed on its dielectric reflectance and its weight. */
const COATED_SPECULAR = `
 if(hasCoat()){
  let coatAb=environmentBrdfPair(lobes.coatRough,saturate(dot(lobes.coatN,V)));
  let coatWeight=lobes.coat*(DIELECTRIC_F0.x*coatAb.x+slabF90(DIELECTRIC_F0)*coatAb.y);
  let under=radiance*(f0*ab.x+vec3f(slabF90(f0)*ab.y*(1.0-lobes.coat)))*(1.0-coatWeight);
  return under+cubeReflection(lobes.coatN,V,lobes.coatRough)*coatWeight;
 }`

/**
 * The ambient cubemap's light on a surface of colour `rgb`, metalness `metal` and roughness `rough`, of normal `N` seen along `V`:
 * `ambientCubemapAt` the column of its diffuse light, under the occlusion `ao`, with a thin surface's back, and the column of its
 * specular light, before the pre-exposure. `lobes`, whether the program holds the lobes (a surface's coat).
 */
export const ambientCubemapWgsl = (lobes: boolean) =>
  wgslBlock(
    `ambientCubemapWgsl(${lobes})`,
    [
      AMBIENT_CUBEMAP_BINDING_WGSL,
      cubemapMipFromRoughness,
      offSpecularPeakDirection,
      ENVIRONMENT_BRDF_WGSL,
      ENVIRONMENT_LIGHTING_WGSL,
      lambertDiffuse,
      slabF90,
      DIELECTRIC_F0,
      PI,
    ],
    `
fn cubeLight(direction:vec3f,mip:f32)->vec3f{
 return textureSampleLevel(ambientCube,ambientCubeSampler,direction,mip).rgb*ambientCubeColour.rgb;
}
/** The cube's irradiance along \`N\`: its diffuse mip's mean radiance times pi, which \`lambertDiffuse\` divides by pi again. */
fn cubeIrradiance(N:vec3f)->vec3f{
 return PI*cubeLight(N,f32(textureNumLevels(ambientCube))-${AMBIENT_CUBEMAP_DIFFUSE_MIP}.0);
}
/** The cube read along the reflection about \`N\` of a lobe of roughness \`rough\`, at the mip the roughness picks. */
fn cubeReflection(N:vec3f,V:vec3f,rough:f32)->vec3f{
 let safe=clamp(rough,0.001,1.0);
 return cubeLight(offSpecularPeakDirection(N,reflect(-V,N),safe),cubemapMipFromRoughness(safe,f32(textureNumLevels(ambientCube))));
}
fn ambientCubemapDiffuse(rgb:vec3f,metal:f32,N:vec3f,ao:f32)->vec3f{
 var light=environmentLightingFrom(rgb,metal,cubeIrradiance(N),ao);
 if(thinSurface()){light+=lambertDiffuse(thinSubsurface,0.0,cubeIrradiance(-N),ao);}
 return light;
}
fn ambientCubemapSpecular(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f)->vec3f{
 let f0=indirectF0(rgb,metal);
 let ab=environmentBrdfPair(rough,saturate(dot(N,V)));
 let radiance=cubeReflection(N,V,rough);${lobes ? COATED_SPECULAR : ''}
 return radiance*(f0*ab.x+vec3f(slabF90(f0)*ab.y))*indirectKeep();
}
fn ambientCubemapAt(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,ao:f32)->mat2x3f{
 return mat2x3f(ambientCubemapDiffuse(rgb,metal,N,ao),ambientCubemapSpecular(rgb,metal,rough,N,V));
}`,
  )
