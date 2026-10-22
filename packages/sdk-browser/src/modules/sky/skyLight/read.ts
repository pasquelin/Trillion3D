import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import {
  skyLightColor,
  type SkyLightPart,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { IRRADIANCE_VECTORS } from './layout.ts'
import { SKY_CUBE_WGSL } from './cubeWgsl.ts'

/**
 * WHAT A PROGRAM READS OF THE SKY LIGHT, the capture's ready cube and its harmonics:
 * - `skyLightReflection(r, roughness)`: the filtered cube along the reflection vector `r` of the
 *   scene, at the mip the roughness asks (`roughnessMip`, trilinear), times the light's colour;
 * - `skyLightDiffuse(n)`: the diffuse light of a surface of normal `n` of the scene, the harmonics
 *   (`skyHarmonicsIrradiance`: three dot products against the first band's vectors, three against
 *   the quadratic terms `n.xyzz * n.yzzx`, one with `n.x² - n.y²`, never negative) times the
 *   light's colour. A program multiplies it by the surface's diffuse colour;
 * - `skyLightApplied()`: whether a cube is there to read.
 * The normal and the vector are turned into the cube's frame (`sceneToCube`) before they are read.
 *
 * The light's colour (`SkyLightRead.colour`) is the light's colour times its intensity times the
 * capture's multiplier (`skyLightColor`), black when the sky lighting is off.
 */

/** Where a program binds the sky light's resources, in the group `group`. */
export interface SkyLightBindings {
  readonly group: number
  /** The ready cube, all its mips. */
  readonly cube: number
  /** The trilinear sampler (`createSkyLightSampler`). */
  readonly sampler: number
  /** The harmonics' buffer, read only. */
  readonly harmonics: number
  /** The uniform of the light's colour and the cube's last mip (`SKY_LIGHT_READ_WORDS`). */
  readonly params: number
}

/** The words of the uniform: the colour (rgb), whether a cube is there, then the last mip. */
export const SKY_LIGHT_READ_WORDS = 8

export const skyLightReadWgsl = (b: SkyLightBindings): WgslDecl =>
  wgslBlock(
    'SKY_LIGHT_READ_WGSL',
    [SKY_CUBE_WGSL],
    `
struct SkyLightRead{colour:vec4f,levels:vec4f,}
@group(${b.group}) @binding(${b.cube}) var skyLightCube:texture_cube<f32>;
@group(${b.group}) @binding(${b.sampler}) var skyLightSampler:sampler;
@group(${b.group}) @binding(${b.harmonics}) var<storage,read> skyHarmonics:array<vec4f,${IRRADIANCE_VECTORS}>;
@group(${b.group}) @binding(${b.params}) var<uniform> skyLight:SkyLightRead;
fn skyLightApplied()->bool{return skyLight.levels.x>0.0;}
fn skyLightReflection(r:vec3f,roughness:f32)->vec3f{
 let mip=roughnessMip(roughness,skyLight.levels.y);
 return textureSampleLevel(skyLightCube,skyLightSampler,sceneToCube(r),mip).rgb*skyLight.colour.rgb;
}
fn skyHarmonicsIrradiance(n:vec3f)->vec3f{
 let v=vec4f(sceneToCube(n),1.0);
 let first=vec3f(dot(skyHarmonics[0],v),dot(skyHarmonics[1],v),dot(skyHarmonics[2],v));
 let quadratic=v.xyzz*v.yzzx;
 let second=vec3f(dot(skyHarmonics[3],quadratic),dot(skyHarmonics[4],quadratic),dot(skyHarmonics[5],quadratic));
 let last=skyHarmonics[6].xyz*(v.x*v.x-v.y*v.y);
 return max(vec3f(0.0),first+second+last);
}
fn skyLightDiffuse(n:vec3f)->vec3f{return skyHarmonicsIrradiance(n)*skyLight.colour.rgb;}
`,
  )

/** The layout entries of a program that reads the sky light as `b` binds it, seen by
 *  `visibility`. */
export function skyLightReadLayoutEntries(
  b: SkyLightBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] {
  return [
    { binding: b.cube, visibility, texture: { sampleType: 'float', viewDimension: 'cube' } },
    { binding: b.sampler, visibility, sampler: { type: 'filtering' } },
    { binding: b.harmonics, visibility, buffer: { type: 'read-only-storage' } },
    { binding: b.params, visibility, buffer: { type: 'uniform' } },
  ]
}

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

/** The uniform into `out` (`SKY_LIGHT_READ_WORDS` floats): the light's colour (`skyLightColor`),
 *  whether a cube of `mips` mips is there to read (0 mips: none), the last mip. */
export function writeSkyLightRead(
  out: Float32Array,
  part: SkyLightPart,
  mips: number,
  skyLighting: boolean,
) {
  out.set([...skyLightColor(part, skyLighting), 0, mips > 0 ? 1 : 0, mips - 1, 0, 0])
  return out
}
