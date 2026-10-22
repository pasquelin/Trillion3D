import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { fieldLayout, putVec4 } from '../../gpu/core/fieldLayout.ts'

/**
 * THE SHADE THE CLOUDS CAST, AS THE LIGHTING READS IT: the clouds' shadow map of each of the air's
 * two lights (`modules/sky/clouds/shadowRun.ts`) and the four inputs of its read, for the fog's
 * sun, the surfaces and the air itself.
 *
 * A map is seen along its light; a texel holds the depth where the cloud begins (kilometres), the
 * mean extinction behind it (per metre) and the greatest optical depth. A point's shade is read
 * from the texel its position falls in (`cloudShadowFactor`): the optical depth is the mean
 * extinction over the way from the front to the point, no more than the greatest, and the share of
 * the light let through is `exp(-optical depth)`, laid in by the light's strength:
 * `mix(1, share, strength)` (the air's, held to 0 to 1). Per light the block holds:
 * - `clip0`, `clip1`: the matrix from a position in centimetres from the camera, on the scene's
 *   axes, to the map's clip space;
 * - `camera`: the camera the matrices are relative to, scene metres;
 * - `far`: the depth of each map's far plane, kilometres;
 * - `strength`: the weight of each light's shade on the surfaces and on the fog (`x`, `y`), then on
 *   the air (`z`, `w`); 0 for a light with no map.
 * A program reads the shade of the air's light `k` at a march's point (`cloudShadowOnAir`), and of
 * the light of rank `rank` in the light buffer at a surface's or the fog's point
 * (`cloudShadowOnSurface`); where it reads no clouds, both answer 1 (`NO_CLOUD_SHADOW_WGSL`).
 */
export const CLOUD_SHADOW_BLOCK = fieldLayout('CloudShadowBlock', [
  ['clip0', 'mat4x4f'],
  ['clip1', 'mat4x4f'],
  ['camera', 'vec4f'],
  ['far', 'vec4f'],
  ['strength', 'vec4f'],
] as const)

/** What a map's lookups hold: its two maps, the sampler they are read through and the block. */
export interface CloudShadowSet {
  readonly maps: readonly [GPUTextureView, GPUTextureView]
  readonly sampler: GPUSampler
  readonly block: GPUBuffer
}

/** The centimetres in a metre. */
const CM_PER_M = 100

/** What a light's map tells the lookups. */
export interface CloudShadowMapFrame {
  /** The matrix from centimetres from the camera to clip space, column-major. */
  readonly clipFromCamera: ArrayLike<number>
  readonly farDepthKm: number
  /** The weights on the surfaces and the fog, and on the air. */
  readonly surfaceStrength: number
  readonly airStrength: number
}

/** The block into `out` (`CLOUD_SHADOW_BLOCK.words` floats) for the maps of the air's two lights
 *  (`undefined`: no map, a strength of 0), the camera at `camera`, scene metres. */
export function writeCloudShadowBlock(
  out: Float32Array<ArrayBuffer>,
  maps: readonly [CloudShadowMapFrame | undefined, CloudShadowMapFrame | undefined],
  camera: ArrayLike<number>,
) {
  const { at } = CLOUD_SHADOW_BLOCK
  out.fill(0)
  maps.forEach((map, k) => {
    if (map) out.set(map.clipFromCamera, k === 0 ? at.clip0 : at.clip1)
    else out.set(IDENTITY, k === 0 ? at.clip0 : at.clip1)
  })
  putVec4(out, at.camera, camera[0], camera[1], camera[2])
  putVec4(out, at.far, maps[0]?.farDepthKm ?? 1, maps[1]?.farDepthKm ?? 1)
  putVec4(
    out,
    at.strength,
    maps[0]?.surfaceStrength ?? 0,
    maps[1]?.surfaceStrength ?? 0,
    maps[0]?.airStrength ?? 0,
    maps[1]?.airStrength ?? 0,
  )
  return out
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Where a program binds the clouds' shade: in group `group`, the block, the two maps and the
 *  sampler they are read through — or, where `sampler` is none, the sampler the program declares
 *  as `samplerName` (the air's tables'). */
export interface CloudShadowBindings {
  readonly group: number
  readonly block: number
  readonly map0: number
  readonly map1: number
  readonly sampler?: number
  readonly samplerName?: string
}

/** What a program that reads no clouds' shade answers: all the light. */
export const NO_CLOUD_SHADOW_WGSL = wgslBlock(
  'NO_CLOUD_SHADOW_WGSL',
  [],
  'fn cloudShadowOnAir(k:u32,P:vec3f)->f32{return 1.0;}\nfn cloudShadowOnSurface(rank:u32,P:vec3f)->f32{return 1.0;}',
)

/** The layout entries of `cloudShadowReadWgsl`'s bindings, seen by `visibility`. */
export const cloudShadowLayoutEntries = (
  b: CloudShadowBindings,
  visibility: GPUShaderStageFlags,
): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(b.block, {}, visibility),
  computeTextureEntry(b.map0, 'float', '2d', visibility),
  computeTextureEntry(b.map1, 'float', '2d', visibility),
  ...(b.sampler === undefined ? [] : [computeSamplerEntry(b.sampler, 'filtering', visibility)]),
]

/** The group entries of `set` as `b` binds it. */
export const cloudShadowBindEntries = (
  b: CloudShadowBindings,
  set: CloudShadowSet,
): GPUBindGroupEntry[] => [
  { binding: b.block, resource: { buffer: set.block } },
  { binding: b.map0, resource: set.maps[0] },
  { binding: b.map1, resource: set.maps[1] },
  ...(b.sampler === undefined ? [] : [{ binding: b.sampler, resource: set.sampler }]),
]

/**
 * The read of the clouds' shade. `cloudShadowFactor(k, P, strength)` is the share of light `k`
 * that reaches the scene's point `P`, laid in by `strength`; the program reads the light buffer by
 * `directLights`, whose atmosphere block holds the lights' slots.
 */
export const cloudShadowReadWgsl = (b: CloudShadowBindings) => {
  const SAMPLER =
    b.sampler === undefined ? (b.samplerName ?? 'cloudShadowSampler') : 'cloudShadowSampler'
  return wgslBlock(
    `cloudShadowReadWgsl(${b.group}, ${b.block}, ${b.map0}, ${b.map1}, ${b.sampler ?? b.samplerName})`,
    [],
    `${CLOUD_SHADOW_BLOCK.wgsl}
@group(${b.group}) @binding(${b.block}) var<uniform> cloudShadowBlock:CloudShadowBlock;
@group(${b.group}) @binding(${b.map0}) var cloudShadowMap0:texture_2d<f32>;
@group(${b.group}) @binding(${b.map1}) var cloudShadowMap1:texture_2d<f32>;
${b.sampler === undefined ? '' : `@group(${b.group}) @binding(${b.sampler}) var cloudShadowSampler:sampler;`}
fn cloudShadowFactor(k:u32,P:vec3f,strength:f32)->f32{
 if(strength<=0.0){return 1.0;}
 var clipFromCamera=cloudShadowBlock.clip0;
 if(k==1u){clipFromCamera=cloudShadowBlock.clip1;}
 let h=clipFromCamera*vec4f((P-cloudShadowBlock.camera.xyz)*${CM_PER_M}.0,1.0);
 let clip=h.xyz/h.w;
 let uv=0.5+vec2f(0.5,-0.5)*clip.xy;
 var data:vec3f;
 if(k==1u){data=textureSampleLevel(cloudShadowMap1,${SAMPLER},uv,0.0).rgb;}
 else{data=textureSampleLevel(cloudShadowMap0,${SAMPLER},uv,0.0).rgb;}
 let sampleKm=saturate(1.0-clip.z)*cloudShadowBlock.far[k];
 let depth=min(data.b,data.g*(max(0.0,sampleKm-data.r)*1000.0));
 return mix(1.0,saturate(exp(-depth)),strength);
}
fn cloudShadowOnAir(k:u32,P:vec3f)->f32{return saturate(cloudShadowFactor(k,P,cloudShadowBlock.strength[2u+k]));}
fn cloudShadowOnSurface(rank:u32,P:vec3f)->f32{
 let slots=directLights.atmosphere[${ATMOSPHERE_SLOT.lightSlots}u];
 var share=1.0;
 for(var k=0u;k<2u;k++){
  if(slots[k]>=0.0&&u32(slots[k])==rank){share=cloudShadowFactor(k,P,cloudShadowBlock.strength[k]);}
 }
 return share;
}`,
  )
}
