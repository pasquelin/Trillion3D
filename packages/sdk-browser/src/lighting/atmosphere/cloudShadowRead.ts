import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { fieldLayout, putVec4 } from '../../gpu/core/fieldLayout.ts'

/**
 * THE SHADE THE CLOUDS CAST, AS THE LIGHTING READS IT: the clouds' shadow map of each of the air's
 * two lights (`modules/sky/clouds/shadowRun.ts`) and the four inputs of its read, for the fog's
 * sun, the surfaces and the air itself.
 *
 * A map is seen along its light; a texel holds the depth where the cloud begins (kilometres), the
 * mean extinction behind it (per metre) and the greatest optical depth. A point's shade is read
 * from the texel its position falls in (`cloudShadowDepth`, `cloudShadowFactor`): the optical depth
 * is the mean extinction over the way from the front to the point, no more than the greatest, and
 * the share of the light let through is `exp(-optical depth)`, laid in by the light's strength:
 * `mix(1, share, strength)` (the air's, held to 0 to 1). The clouds' own trace reads the optical
 * depth alone: the map already holds the light's cloud shadow strength. Per light the block holds:
 * - `clip0`, `clip1`: the matrix from a position in centimetres from the camera, on the scene's
 *   axes, to the map's clip space;
 * - `camera`: the camera the matrices are relative to, scene metres;
 * - `far`: the depth of each map's far plane, kilometres (`x`, `y`), then the sky occlusion map's
 *   (`z`, 0 where there is none);
 * - `strength`: the weight of each light's shade on the surfaces and on the fog (`x`, `y`), then on
 *   the air (`z`, `w`); 0 for a light with no map.
 * A program reads the shade of the air's light `k` at a march's point (`cloudShadowOnAir`), and of
 * the light of rank `rank` in the light buffer at a surface's or the fog's point
 * (`cloudShadowOnSurface`); where it reads no clouds, both answer 1 (`NO_CLOUD_SHADOW_WGSL`). A
 * translucent surface reads it per vertex (`CloudShadowBindings.perVertex`): the vertex stage asks
 * the shade of the one light (`cloudShadeAt`), the fragment stage is told it
 * (`cloudShadeVertex`) and gives it to the light the buffer's header names (`forwardRank`) alone.
 *
 * The clouds' sky occlusion map (`modules/sky/clouds/skyOcclusionRun.ts`) is read the same way
 * through `clipSky` and `far.z`, by the air's marches alone (`CloudShadowBindings.ao`,
 * `cloudSkyOcclusionAt`): it holds the strength of the sky light's `cloudAmbientOcclusion…`
 * fields already, and what it answers is the share of the air's multiple scattering the clouds
 * above the point leave.
 */
export const CLOUD_SHADOW_BLOCK = fieldLayout('CloudShadowBlock', [
  ['clip0', 'mat4x4f'],
  ['clip1', 'mat4x4f'],
  ['clipSky', 'mat4x4f'],
  ['camera', 'vec4f'],
  ['far', 'vec4f'],
  ['strength', 'vec4f'],
] as const)

/** What a program that reads the shade of one light alone binds (`CloudShadowBindings.perVertex`):
 *  the block, that light's map and the sampler it is read through. */
export interface CloudShadeSet {
  readonly block: GPUBuffer
  readonly map: GPUTextureView
  readonly sampler: GPUSampler
}

/** What a map's lookups hold: its two maps, the sampler they are read through and the block; the
 *  clouds' sky occlusion map (`ao`, the stand-in where none is built: the block says so, `far.z`);
 *  and what the block was written from, where the maps were built this image — the frame of each
 *  light's map and the camera the matrices are relative to, scene metres — for a reader that makes a
 *  block of its own of one light's (`translucentCloudVertex`). */
export interface CloudShadowSet {
  readonly maps: readonly [GPUTextureView, GPUTextureView]
  readonly ao: GPUTextureView
  readonly sampler: GPUSampler
  readonly block: GPUBuffer
  readonly frames?: readonly [CloudShadowMapFrame | undefined, CloudShadowMapFrame | undefined]
  /** What the sky occlusion map tells the lookups, where it is built. */
  readonly skyFrame?: CloudSkyMapFrame
  readonly camera?: ArrayLike<number>
}

/** What a light's map tells the lookups. */
export interface CloudShadowMapFrame {
  /** The matrix from centimetres from the camera to clip space, column-major. */
  readonly clipFromCamera: ArrayLike<number>
  /** The matrix back from clip space to centimetres from the camera, column-major. */
  readonly cameraFromClip: ArrayLike<number>
  /** The direction of the map's rays, from the light, on the scene's axes. */
  readonly rayDirection: readonly [number, number, number]
  /** The samples of a ray of the map. */
  readonly samples: number
  /** The side of the map the lookups read, in texels. */
  readonly side: number
  readonly farDepthKm: number
  /** The weights on the surfaces and the fog, and on the air. */
  readonly surfaceStrength: number
  readonly airStrength: number
}

/** What the sky occlusion map tells the lookups: its matrices, its rays' direction, its side and the depth of its far plane. It has
 *  no weight of its own: the map holds it. */
export type CloudSkyMapFrame = Pick<
  CloudShadowMapFrame,
  'clipFromCamera' | 'cameraFromClip' | 'rayDirection' | 'side' | 'farDepthKm'
>

/** The block into `out` (`CLOUD_SHADOW_BLOCK.words` floats) for the maps of the air's two lights
 *  (`undefined`: no map, a strength of 0), the camera at `camera`, scene metres, and the sky
 *  occlusion map `sky` (`undefined`: none, a far depth of 0, which reads as no occlusion). */
export function writeCloudShadowBlock(
  out: Float32Array<ArrayBuffer>,
  maps: readonly [CloudShadowMapFrame | undefined, CloudShadowMapFrame | undefined],
  camera: ArrayLike<number>,
  sky?: CloudSkyMapFrame,
) {
  const { at } = CLOUD_SHADOW_BLOCK
  out.fill(0)
  maps.forEach((map, k) => {
    if (map) out.set(map.clipFromCamera, k === 0 ? at.clip0 : at.clip1)
    else out.set(IDENTITY_MATRIX4, k === 0 ? at.clip0 : at.clip1)
  })
  out.set(sky ? sky.clipFromCamera : IDENTITY_MATRIX4, at.clipSky)
  putVec4(out, at.camera, camera[0], camera[1], camera[2])
  putVec4(out, at.far, maps[0]?.farDepthKm ?? 1, maps[1]?.farDepthKm ?? 1, sky?.farDepthKm ?? 0)
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

/** Where a program binds the clouds' shade: in group `group`, the block, the two maps and the
 *  sampler they are read through — or, where `sampler` is none, the sampler the program declares
 *  as `samplerName` (the air's tables'). */
export interface CloudShadowBindings {
  readonly group: number
  readonly block: number
  readonly map0: number
  /** The second light's map: none in the per-vertex form, which reads the first's alone. */
  readonly map1?: number
  /** The sky occlusion map, for a program that reads it (`cloudSkyOcclusionAt`): the air's marches. */
  readonly ao?: number
  readonly sampler?: number
  readonly samplerName?: string
  /** The translucent surfaces' form: the block and the first map are those of the one light their
   *  vertices read the shade of (`cloudShadeAt`), and a surface's share is that shade as its vertices
   *  gave it (`cloudShadeVertex`), applied to the light the buffer's header names (`forwardRank`, one
   *  past the light's rank, 0 for none). It binds no second map. */
  readonly perVertex?: boolean
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
  ...(b.map1 === undefined ? [] : [computeTextureEntry(b.map1, 'float', '2d', visibility)]),
  ...(b.ao === undefined ? [] : [computeTextureEntry(b.ao, 'float', '2d', visibility)]),
  ...(b.sampler === undefined ? [] : [computeSamplerEntry(b.sampler, 'filtering', visibility)]),
]

/** The group entries of `set` as `b` binds it. */
export const cloudShadowBindEntries = (
  b: CloudShadowBindings,
  set: CloudShadowSet,
): GPUBindGroupEntry[] => [
  { binding: b.block, resource: { buffer: set.block } },
  { binding: b.map0, resource: set.maps[0] },
  ...(b.map1 === undefined ? [] : [{ binding: b.map1, resource: set.maps[1] }]),
  ...(b.ao === undefined ? [] : [{ binding: b.ao, resource: set.ao }]),
  ...(b.sampler === undefined ? [] : [{ binding: b.sampler, resource: set.sampler }]),
]

/** A surface's share where the point is read: of the light of rank `rank`, the shade of its map. */
const PER_POINT_SURFACE = `fn cloudShadowOnSurface(rank:u32,P:vec3f)->f32{
 let slots=directLights.atmosphere[${ATMOSPHERE_SLOT.lightSlots}u];
 var share=1.0;
 for(var k=0u;k<2u;k++){
  if(slots[k]>=0.0&&u32(slots[k])==rank){share=cloudShadowFactor(k,P,cloudShadowBlock.strength[k]);}
 }
 return share;
}`

/** A translucent surface's share, per vertex: the vertex stage reads the shade of the one light the
 *  block and the first map are of (`cloudShadeAt`); the fragment stage sets what its vertices gave
 *  it (`cloudShadeVertex`), which the light the header names takes. */
const PER_VERTEX_SURFACE = `fn cloudShadeAt(P:vec3f)->f32{return cloudShadowFactor(0u,P,cloudShadowBlock.strength[0]);}
var<private> cloudShadeVertex:f32=1.0;
fn cloudShadowOnSurface(rank:u32,P:vec3f)->f32{return select(1.0,cloudShadeVertex,directLights.forwardRank==rank+1u);}`

/** The sky occlusion map's read: the share of the air's multiple scattering the clouds leave at the
 *  scene's point `P`, the map's own optical depth read as a light map's (`cloudMapDepth`); 1 where
 *  the block holds no map (`far.z` 0). */
const SKY_OCCLUSION = (sampler: string) => `fn cloudSkyOcclusionAt(P:vec3f)->f32{
 let farKm=cloudShadowBlock.far.z;
 if(farKm<=0.0){return 1.0;}
 let at=cloudMapPoint(cloudShadowBlock.clipSky,P);
 let data=textureSampleLevel(cloudSkyMap,${sampler},at.xy,0.0).rgb;
 return saturate(exp(-cloudMapDepth(data,at.z,farKm)));
}`

/**
 * The read of the clouds' shade. `cloudShadowFactor(k, P, strength)` is the share of light `k`
 * that reaches the scene's point `P`, laid in by `strength`; the program reads the light buffer by
 * `directLights`, whose atmosphere block holds the lights' slots. `cloudMapPoint` is a map's uv and
 * clip depth at `P`, `cloudMapDepth` the optical depth its texel `data` gives there (the mean
 * extinction over the way from the front depth to the point, no more than the greatest).
 */
export const cloudShadowReadWgsl = (b: CloudShadowBindings) => {
  const SAMPLER =
    b.sampler === undefined ? (b.samplerName ?? 'cloudShadowSampler') : 'cloudShadowSampler'
  const read = (map: string) => `textureSampleLevel(${map},${SAMPLER},uv,0.0).rgb`
  return wgslBlock(
    `cloudShadowReadWgsl(${b.group}, ${b.block}, ${b.map0}, ${b.map1}, ${b.ao}, ${b.sampler ?? b.samplerName}${b.perVertex ? ', perVertex' : ''})`,
    [],
    `${CLOUD_SHADOW_BLOCK.wgsl}
@group(${b.group}) @binding(${b.block}) var<uniform> cloudShadowBlock:CloudShadowBlock;
@group(${b.group}) @binding(${b.map0}) var cloudShadowMap0:texture_2d<f32>;
${b.map1 === undefined ? '' : `@group(${b.group}) @binding(${b.map1}) var cloudShadowMap1:texture_2d<f32>;`}
${b.ao === undefined ? '' : `@group(${b.group}) @binding(${b.ao}) var cloudSkyMap:texture_2d<f32>;`}
${b.sampler === undefined ? '' : `@group(${b.group}) @binding(${b.sampler}) var cloudShadowSampler:sampler;`}
fn cloudMapPoint(clipFromCamera:mat4x4f,P:vec3f)->vec3f{
 let h=clipFromCamera*vec4f((P-cloudShadowBlock.camera.xyz)*${CENTIMETRES_PER_METRE}.0,1.0);
 let clip=h.xyz/h.w;
 return vec3f(0.5+vec2f(0.5,-0.5)*clip.xy,clip.z);
}
fn cloudMapDepth(data:vec3f,z:f32,farKm:f32)->f32{
 let sampleKm=saturate(1.0-z)*farKm;
 return min(data.b,data.g*(max(0.0,sampleKm-data.r)*1000.0));
}
fn cloudShadowDepth(k:u32,P:vec3f)->f32{
 var clipFromCamera=cloudShadowBlock.clip0;
 if(k==1u){clipFromCamera=cloudShadowBlock.clip1;}
 let at=cloudMapPoint(clipFromCamera,P);
 let uv=at.xy;
${
  b.map1 === undefined
    ? ` let data=${read('cloudShadowMap0')};`
    : ` var data:vec3f;
 if(k==1u){data=${read('cloudShadowMap1')};}
 else{data=${read('cloudShadowMap0')};}`
}
 return cloudMapDepth(data,at.z,cloudShadowBlock.far[k]);
}
${b.ao === undefined ? '' : SKY_OCCLUSION(SAMPLER)}
fn cloudShadowFactor(k:u32,P:vec3f,strength:f32)->f32{
 if(strength<=0.0){return 1.0;}
 return mix(1.0,saturate(exp(-cloudShadowDepth(k,P))),strength);
}
fn cloudShadowOnAir(k:u32,P:vec3f)->f32{return saturate(cloudShadowFactor(k,P,cloudShadowBlock.strength[2u+k]));}
${b.perVertex ? PER_VERTEX_SURFACE : PER_POINT_SURFACE}`,
  )
}
