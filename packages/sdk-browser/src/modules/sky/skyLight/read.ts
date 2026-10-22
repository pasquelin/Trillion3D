import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import {
  skyLightColor,
  skyLightContrastCurve,
  skyLightOcclusion,
  type SkyLightPart,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { HARMONICS_SET_VECTORS, HARMONICS_SETS } from './layout.ts'
import { SKY_CUBE_WGSL } from './cubeWgsl.ts'

/**
 * WHAT A PROGRAM READS OF THE SKY LIGHT, the capture's ready cube and its harmonics. Two reads, the
 * second over the first:
 * - the diffuse read (`skyLightDiffuseWgsl`): the harmonics and the light's uniform alone, for a
 *   program that needs no texture (the volumetric fog's cells);
 * - the whole read (`skyLightReadWgsl`): the cube and its sampler beside them, for a program that
 *   reflects.
 *
 * What a program calls:
 * - `skyLightReflection(r, roughness)`: the filtered cube along the reflection vector `r` of the
 *   scene, at the mip the roughness asks (`roughnessMip`, trilinear), times the light's colour; with
 *   a blend (`SkyLightCubeUse.blend`) above 0, mixed with the blend destination's cube by that
 *   fraction (the destination multiplied by the colour);
 * - `skyLightRay(d)`: the same along a ray `d` that leaves the scene, of roughness 0;
 * - `skyLightDiffuse(n)`: the diffuse light of a surface of normal `n` of the scene, the harmonics
 *   (`skyHarmonicsIrradiance`: three dot products against the first band's vectors, three against
 *   the quadratic terms `n.xyzz * n.yzzx`, one with `n.x² - n.y²`, never negative) times the
 *   light's colour. A program multiplies it by the surface's diffuse colour;
 *   `skyLightDiffuseSimple(n)`: the same of the first three terms alone, what the fog reads;
 *   `skyLightIrradiance(n)`: π times the diffuse light, the irradiance for the engine's one Lambert
 *   (`lambertDiffuse` divides by π);
 * - `skyLightScattering()`: the share of the light the volumetric fog scatters;
 * - `skyLightApplied()`: whether a cube is there to read, for a view the sky lighting is on in.
 * The normal and the vector are turned into the cube's frame (`sceneToCube`) before they are read.
 *
 * The light's colour (`SkyLightRead.colour`) is the light's colour times its intensity times the
 * capture's multiplier (`skyLightColor`), black when the sky lighting is off.
 */

/** Where a program binds the sky light's resources, in the group `group`. */
export interface SkyLightBindings {
  readonly group: number
  /** The ready cubes, a cube array of all their mips (`SkyLightReadSet.cube`). */
  readonly cube: number
  /** The trilinear sampler (`createSkyLightSampler`). */
  readonly sampler: number
  /** The harmonics' buffer, read as a uniform. */
  readonly harmonics: number
  /** The uniform of the light's colour and the cube's last mip (`SKY_LIGHT_READ_WORDS`). */
  readonly params: number
}

/** The bindings of the diffuse read: the harmonics and the uniform. */
export type SkyLightDiffuseBindings = Pick<SkyLightBindings, 'group' | 'harmonics' | 'params'>

/** What a program is given to read the sky light with. */
export interface SkyLightReadSet {
  /** The cubes the capture filtered, all their layers and mips, as a cube array. */
  readonly cube: GPUTextureView
  readonly sampler: GPUSampler
  /** The harmonics (a set of `HARMONICS_SET_VECTORS` vec4s a filtered cube), read as a uniform. */
  readonly harmonics: GPUBuffer
  /** The light's uniform of the view (`SKY_LIGHT_READ_WORDS` floats, `writeSkyLightRead`). */
  readonly params: GPUBuffer
}

/** The words of the uniform: the colour (rgb) and the share of the light the volumetric fog
 *  scatters; whether a cube is there, the last mip, the layer of the cube read and the blend's
 *  fraction; the occlusion's tint and least occlusion, its contrast curve and exponent, and how it
 *  is applied (`writeSkyLightRead`). */
export const SKY_LIGHT_READ_WORDS = 20

const STRUCT =
  'struct SkyLightRead{colour:vec4f,levels:vec4f,tint:vec4f,contrast:vec4f,mode:vec4f,}'

/** The diffuse read over the bindings `b`. */
export const skyLightDiffuseWgsl = (b: SkyLightDiffuseBindings): WgslDecl =>
  wgslBlock(
    `SKY_LIGHT_DIFFUSE_WGSL(${b.group}, ${b.harmonics}, ${b.params})`,
    [SKY_CUBE_WGSL, PI],
    `
${STRUCT}
@group(${b.group}) @binding(${b.harmonics}) var<uniform> skyHarmonics:array<vec4f,${HARMONICS_SETS * HARMONICS_SET_VECTORS}>;
@group(${b.group}) @binding(${b.params}) var<uniform> skyLight:SkyLightRead;
fn skyLightApplied()->bool{return skyLight.levels.x>0.0;}
fn skyLightScattering()->f32{return skyLight.colour.w;}
fn skyHarmonic(k:u32)->vec4f{
 let base=u32(skyLight.levels.z)*${HARMONICS_SET_VECTORS}u;
 var h=skyHarmonics[base+k];
 if(skyLight.levels.w>0.0){h=mix(h,skyHarmonics[base+${HARMONICS_SET_VECTORS}u+k],skyLight.levels.w);}
 return h;
}
fn skyHarmonicsIrradiance(n:vec3f)->vec3f{
 let v=vec4f(sceneToCube(n),1.0);
 let first=vec3f(dot(skyHarmonic(0u),v),dot(skyHarmonic(1u),v),dot(skyHarmonic(2u),v));
 let quadratic=v.xyzz*v.yzzx;
 let second=vec3f(dot(skyHarmonic(3u),quadratic),dot(skyHarmonic(4u),quadratic),dot(skyHarmonic(5u),quadratic));
 let last=skyHarmonic(6u).xyz*(v.x*v.x-v.y*v.y);
 return max(vec3f(0.0),first+second+last);
}
fn skyLightDiffuse(n:vec3f)->vec3f{return skyHarmonicsIrradiance(n)*skyLight.colour.rgb;}
fn skyLightDiffuseSimple(n:vec3f)->vec3f{
 let v=vec4f(sceneToCube(n),1.0);
 return max(vec3f(0.0),vec3f(dot(skyHarmonic(0u),v),dot(skyHarmonic(1u),v),dot(skyHarmonic(2u),v)))*skyLight.colour.rgb;
}
fn skyLightIrradiance(n:vec3f)->vec3f{return PI*skyLightDiffuse(n);}
`,
  )

/** The whole read over the bindings `b`. */
export const skyLightReadWgsl = (b: SkyLightBindings): WgslDecl =>
  wgslBlock(
    `SKY_LIGHT_READ_WGSL(${b.group}, ${b.cube}, ${b.sampler}, ${b.harmonics}, ${b.params})`,
    [skyLightDiffuseWgsl(b)],
    `
@group(${b.group}) @binding(${b.cube}) var skyLightCube:texture_cube_array<f32>;
@group(${b.group}) @binding(${b.sampler}) var skyLightSampler:sampler;
fn skyLightReflection(r:vec3f,roughness:f32)->vec3f{
 let d=sceneToCube(r);
 let mip=roughnessMip(roughness,skyLight.levels.y);
 let layer=i32(skyLight.levels.z);
 var sky=textureSampleLevel(skyLightCube,skyLightSampler,d,layer,mip).rgb*skyLight.colour.rgb;
 if(skyLight.levels.w>0.0){
  let destination=textureSampleLevel(skyLightCube,skyLightSampler,d,layer+1,mip).rgb*skyLight.colour.rgb;
  sky=mix(sky,destination,skyLight.levels.w);
 }
 return sky;
}
fn skyLightRay(d:vec3f)->vec3f{return skyLightReflection(d,0.0);}
`,
  )

/** The layout entries of a program that reads the diffuse light as `b` binds it, seen by
 *  `visibility`. */
const skyLightDiffuseLayoutEntries = (
  b: SkyLightDiffuseBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(b.harmonics, 'uniform', visibility),
  computeBufferEntry(b.params, 'uniform', visibility),
]

/** The layout entries of a program that reads the sky light as `b` binds it, seen by
 *  `visibility`. */
export const skyLightReadLayoutEntries = (
  b: SkyLightBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] => [
  computeTextureEntry(b.cube, 'float', 'cube-array', visibility),
  computeSamplerEntry(b.sampler, 'filtering', visibility),
  ...skyLightDiffuseLayoutEntries(b, visibility),
]

/** The group entries of `set` for the diffuse read of `b`. */
const skyLightDiffuseBindEntries = (
  b: SkyLightDiffuseBindings,
  set: SkyLightReadSet,
): GPUBindGroupEntry[] => [
  { binding: b.harmonics, resource: { buffer: set.harmonics } },
  { binding: b.params, resource: { buffer: set.params } },
]

/** The group entries of `set` for the whole read of `b`. */
export const skyLightReadBindEntries = (
  b: SkyLightBindings,
  set: SkyLightReadSet,
): GPUBindGroupEntry[] => [
  { binding: b.cube, resource: set.cube },
  { binding: b.sampler, resource: set.sampler },
  ...skyLightDiffuseBindEntries(b, set),
]

/** The sampler the cube is read through: trilinear, clamped. */
export const createSkyLightSampler = (device: GPUDevice) =>
  device.createSampler({
    label: 'Trillion3D sky light read',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  })

/** How the distance-field occlusion applies to the light this image: whether a bent normal is read (`applied`), the
 *  specular occlusion's mode and strength (`DistanceFieldOcclusionSettings`). */
export interface SkyLightOcclusionUse {
  applied: boolean
  specularMode: number
  specularStrength: number
}

/** The occlusion not applied. */
export const NO_SKY_LIGHT_OCCLUSION: SkyLightOcclusionUse = {
  applied: false,
  specularMode: 1,
  specularStrength: 1,
}

/** Which cube of the array a read takes, and how much of the next one it mixes in: the layer, and the
 *  blend's fraction of the destination cube at the layer after it (`SetCubemapBlend`), 0 for no blend. */
export interface SkyLightCubeUse {
  layer: number
  blend: number
}

/** One cube, no blend. */
const FIRST_SKY_LIGHT_CUBE: SkyLightCubeUse = { layer: 0, blend: 0 }

/** The uniform into `out` (`SKY_LIGHT_READ_WORDS` floats): the light's colour (`skyLightColor`) and
 *  the share of it the volumetric fog scatters (never negative); whether a cube of `mips` mips is
 *  there to read in a view the sky lighting is on in (0 mips, or off: none), the last mip, the
 *  layer of the cube and the blend's fraction (`cube`); the occlusion's tint and least
 *  occlusion (`skyLightOcclusion`), its contrast curve's contrast, scale and bias (`skyLightContrastCurve`) and exponent,
 *  and `mode`: the combine mode (0 the least of the occlusions, 1 their product), whether a bent normal is applied,
 *  the reciprocal of the specular strength, the specular mode. `cubemapScale` is
 *  the rescale of a 32-bit float cubemap (`SkyLightCubeRead.colorScale`). */
export function writeSkyLightRead(
  out: Float32Array,
  part: SkyLightPart,
  mips: number,
  skyLighting: boolean,
  cubemapScale = 1,
  occlusion: SkyLightOcclusionUse = NO_SKY_LIGHT_OCCLUSION,
  cube: SkyLightCubeUse = FIRST_SKY_LIGHT_CUBE,
) {
  const o = skyLightOcclusion(part)
  const curve = skyLightContrastCurve(o.contrast)
  out.set([
    ...skyLightColor(part, skyLighting, cubemapScale),
    Math.max(part.light.volumetricScatteringIntensity, 0),
    skyLighting && mips > 0 ? 1 : 0,
    mips - 1,
    cube.layer,
    cube.blend,
  ])
  out.set([o.tint[0], o.tint[1], o.tint[2], o.minOcclusion], 8)
  out.set([o.contrast, curve.mul, curve.add, o.exponent], 12)
  out.set(
    [
      o.combineMode === 'minimum' ? 0 : 1,
      occlusion.applied ? 1 : 0,
      1 / Math.max(occlusion.specularStrength, 0.1),
      occlusion.specularMode,
    ],
    16,
  )
  return out
}
