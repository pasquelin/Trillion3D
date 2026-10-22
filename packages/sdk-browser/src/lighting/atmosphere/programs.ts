import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import {
  computeBufferEntry,
  computeUniformEntry,
  namedEntries,
} from '../../gpu/core/computeBindings.ts'
import { fogReadLayoutEntries } from '../fog/read.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { AIR_SHADOW_WGSL } from './airShadowWgsl.ts'
import { cloudShadowReadWgsl, type CloudShadowBindings } from './cloudShadowRead.ts'
import { AIR_BINDING, type AirBindingName } from './binding.ts'
import { FRAME_WGSL } from './frame.ts'
import { AIR_BUFFER_STRUCT } from './layout.ts'
import { SCATTER_WGSL } from './scatterWgsl.ts'
import { DEFAULT_AIR_SHAPE, shapeConstants, type AirShape } from './shape.ts'

export { AIR_BINDING }

/** Where a program that binds the fog (`AirBindings.fog`) reads its cubemap and volume
 *  (`fogResourcesWgsl`), in group 0. */
export const AIR_FOG_BINDINGS = {
  group: 0,
  sampler: AIR_BINDING.fogSampler,
  cubemap: AIR_BINDING.fogCubemap,
  volume: AIR_BINDING.fogVolume,
} as const

/** The fog's bindings of the sky's draw: those of `AIR_FOG_BINDINGS` and the light shafts' occlusion
 *  mask, which multiplies the fog's inscattering over the sky's pixels (`fogBeyondAt`). */
export const SKY_FOG_BINDINGS = {
  ...AIR_FOG_BINDINGS,
  lightShaft: AIR_BINDING.lightShaft,
} as const

/** What a program binds, by name: its tables are bound as the shader names them. */
export type AirBindings = {
  /** How the light buffer is bound: read-only, or written (the haze volume, the sky's mean). */
  air: 'read' | 'read_write'
  /** The table written, a storage texture: the transmittance table (`'transmittance'`, whose
   *  format the shape picks) or another. */
  table?: boolean | 'transmittance'
  /** The buffer is declared whole (`DirectLights`, `../direct/lightWgsl.ts`, which the program
   *  includes), for a program that reads the lights themselves; else its front (`AirBuffer`). */
  lights?: boolean
  /** The tables read. */
  transmittance?: boolean
  multiScatter?: boolean
  skyView?: boolean
  frame?: boolean
  flags?: boolean
  /** The fog's cubemap and volume, which the fog the program lays over the sky reads
   *  (`AIR_FOG_BINDINGS`, `skyWgsl.ts`). */
  fog?: boolean
  /** The light shafts' occlusion mask, read through the fog's sampler (`SKY_FOG_BINDINGS`). */
  lightShaft?: boolean
  /** The virtual shadow maps the air's lights shade the air with (`airShadowWgsl.ts`); the program
   *  declares `airToScene`. The buffer is declared whole. */
  shadow?: boolean
  /** The blue noise the march jitters its samples by (`blueNoiseScalar`, `../../gpu/noise/blueNoiseWgsl.ts`). */
  noise?: boolean
  /** The volumes the clouds read besides the haze (`separatedWgsl.ts`). */
  volumes?: boolean
  /** The shade the clouds cast on the air's lights (`cloudShadowRead.ts`): the program declares
   *  `airToScene`, and reads the maps through the tables' sampler. */
  cloudShadow?: boolean
  /** The scene's depth, read by the haze marched on the opaque surfaces. */
  depth?: boolean
}

/** Whether the buffer is declared whole: asked for, or read for the shadows' lights. */
const wholeBuffer = (bindings: AirBindings) => !!(bindings.lights || bindings.shadow)

/** The bindings a program that binds `bindings` has under a shape, in the order of
 *  `AIR_BINDING`'s declaration: a table the shape does not make is not bound, the air answers as
 *  no air would (`declarations`). */
export function boundNames(bindings: AirBindings, shape: AirShape): AirBindingName[] {
  const transmittance = bindings.transmittance && shape.transmittance.on
  const wanted: Partial<Record<AirBindingName, unknown>> = {
    air: true,
    table: bindings.table,
    transmittance,
    multiScatter: bindings.multiScatter,
    sampler: transmittance || bindings.multiScatter || bindings.skyView || bindings.cloudShadow,
    frame: bindings.frame,
    skyView: bindings.skyView,
    flags: bindings.flags,
    fogSampler: bindings.fog,
    fogCubemap: bindings.fog,
    fogVolume: bindings.fog,
    lightShaft: bindings.lightShaft,
    pageTable: bindings.shadow,
    projectionData: bindings.shadow,
    shadowUniforms: bindings.shadow,
    shadowPool: bindings.shadow,
    shadowView: bindings.shadow,
    noise: bindings.noise,
    volumes: bindings.volumes,
    cloudShadow: bindings.cloudShadow,
    cloudShadowMap0: bindings.cloudShadow,
    cloudShadowMap1: bindings.cloudShadow,
    depth: bindings.depth,
  }
  return (Object.keys(AIR_BINDING) as AirBindingName[]).filter((name) => wanted[name])
}

/** The format of the table a program writes: the transmittance table's is the shape's, the others
 *  four half floats. */
export const tableFormatOf = (
  bindings: AirBindings,
  shape: AirShape,
): 'rgba8unorm' | 'rgba16float' =>
  bindings.table === 'transmittance' && shape.transmittance.small ? 'rgba8unorm' : 'rgba16float'

const b = AIR_BINDING

/** Where the air's programs bind the clouds' shade: in group 0, read through the tables' sampler. */
export const AIR_CLOUD_SHADOW: CloudShadowBindings = {
  group: 0,
  block: b.cloudShadow,
  map0: b.cloudShadowMap0,
  map1: b.cloudShadowMap1,
  samplerName: 'tableSampler',
}

/** The accessor of a table the program samples: the table decoded as it was encoded (the
 *  transmittance table holds its square root, which keeps its low values in eight bits), or, for a
 *  table the program does not bind, the answer of no air (nothing scattered, nothing lost). */
function tableAccessors(bindings: AirBindings, shape: AirShape) {
  const sampled = (name: 'transmittance' | 'multiScatter' | 'skyView') =>
    boundNames(bindings, shape).includes(name)
  const t = sampled('transmittance')
  const m = sampled('multiScatter')
  return `
${
  t
    ? `@group(0) @binding(${b.transmittance}) var transmittanceTable:texture_2d<f32>;
fn transmittanceStored(uv:vec2f)->vec3f{return textureSampleLevel(transmittanceTable,tableSampler,uv,0.0).rgb;}`
    : 'fn transmittanceStored(uv:vec2f)->vec3f{return vec3f(1.0);}'
}
fn transmittanceAt(uv:vec2f)->vec3f{let t=transmittanceStored(uv);return t*t;}
${
  m
    ? `@group(0) @binding(${b.multiScatter}) var multiScatterTable:texture_2d<f32>;
fn multiScatterAt(uv:vec2f)->vec3f{return textureSampleLevel(multiScatterTable,tableSampler,uv,0.0).rgb;}`
    : 'fn multiScatterAt(uv:vec2f)->vec3f{return vec3f(0.0);}'
}
${bindings.skyView ? `@group(0) @binding(${b.skyView}) var skyViewTable:texture_2d<f32>;` : ''}`
}

/** The declarations of a program that binds `bindings` under `shape`: the shape's constants, the
 *  buffer's front, named as the lighting names the whole buffer (`directLights`), so that the fog's
 *  and the haze's reads run in a program of the air as they do in the lighting, and the accessors
 *  the march reads the air through (`opticsWgsl.ts`). */
function declarations(bindings: AirBindings, shape: AirShape) {
  const names = boundNames(bindings, shape)
  const has = (name: AirBindingName) => names.includes(name)
  return `${shapeConstants(shape)}
${AIR_BUFFER_STRUCT}
@group(0) @binding(${b.air}) var<storage,${bindings.air}> directLights:${wholeBuffer(bindings) ? 'DirectLights' : 'AirBuffer'};
fn atmo(slot:u32)->vec4f{return directLights.atmosphere[slot];}
${bindings.shadow ? '' : 'fn airShadow(k:u32,p:vec3f)->f32{return 1.0;}'}
${bindings.cloudShadow ? 'fn airCloudShadow(k:u32,p:vec3f)->f32{return cloudShadowOnAir(k,airToScene(p));}' : 'fn airCloudShadow(k:u32,p:vec3f)->f32{return 1.0;}'}
${has('table') ? `@group(0) @binding(${b.table}) var table:texture_storage_2d<${tableFormatOf(bindings, shape)},write>;` : ''}
${has('sampler') ? `@group(0) @binding(${b.sampler}) var tableSampler:sampler;` : ''}${tableAccessors(bindings, shape)}
${bindings.frame ? `@group(0) @binding(${b.frame}) var<uniform> frame:AirFrame;` : ''}
${bindings.depth ? `@group(0) @binding(${b.depth}) var depthTex:texture_depth_2d;` : ''}
${bindings.flags ? `@group(0) @binding(${b.flags}) var flags:texture_2d<u32>;` : ''}
${bindings.volumes ? `@group(0) @binding(${b.volumes}) var<storage,read_write> volumes:array<vec2u>;` : ''}
`
}

/** A whole program: its bindings, and its text — their declarations, the march and the frame, and
 *  its own text — for the shape it was made under. */
export interface AirProgram {
  readonly bindings: AirBindings
  readonly code: string
}

/** The program that binds `bindings` and has the text `own`, with the fragments `uses`, written for
 *  `shape` (the shape of the defaults unless given: the programs another module builds on). */
export const airProgram = (
  bindings: AirBindings,
  own: string,
  uses: readonly WgslDecl[] = [],
  shape: AirShape = DEFAULT_AIR_SHAPE,
): AirProgram => ({
  bindings,
  code: wgslProgram(`${declarations(bindings, shape)}\n${own}`, [
    SCATTER_WGSL,
    FRAME_WGSL,
    ...(bindings.shadow ? [AIR_SHADOW_WGSL] : []),
    ...(bindings.noise ? [blueNoiseWgsl(0, b.noise)] : []),
    ...(bindings.cloudShadow ? [cloudShadowReadWgsl(AIR_CLOUD_SHADOW)] : []),
    ...uses,
  ]),
})

/** The layout entry of one binding, seen by `visibility`. */
function layoutEntry(
  name: AirBindingName,
  visibility: GPUShaderStageFlags,
  bindings: AirBindings,
  shape: AirShape,
): GPUBindGroupLayoutEntry[] {
  const at = b[name]
  const sampled = (sampleType: GPUTextureSampleType = 'float') => [
    { binding: at, visibility, texture: { sampleType, viewDimension: '2d' as const } },
  ]
  switch (name) {
    case 'air':
      return [
        {
          binding: at,
          visibility,
          buffer: { type: bindings.air === 'read' ? 'read-only-storage' : 'storage' },
        },
      ]
    case 'table':
      return [
        {
          binding: at,
          visibility,
          storageTexture: {
            access: 'write-only',
            format: tableFormatOf(bindings, shape),
            viewDimension: '2d',
          },
        },
      ]
    case 'sampler':
      return [{ binding: at, visibility, sampler: { type: 'filtering' } }]
    case 'frame':
    case 'shadowUniforms':
    case 'shadowView':
      return [computeUniformEntry(at, {}, visibility)]
    case 'cloudShadow':
      return [computeUniformEntry(at, {}, visibility)]
    case 'cloudShadowMap0':
    case 'cloudShadowMap1':
      return sampled()
    case 'volumes':
      return [{ binding: at, visibility, buffer: { type: 'storage' } }]
    case 'pageTable':
    case 'projectionData':
    case 'shadowPool':
      return [computeBufferEntry(at, 'read-only-storage', visibility)]
    case 'flags':
      return sampled('uint')
    case 'depth':
      return sampled('depth')
    case 'fogSampler':
      return fogReadLayoutEntries(AIR_FOG_BINDINGS, visibility)
    case 'fogCubemap':
    case 'fogVolume':
      return []
    default:
      return sampled()
  }
}

/** The bind group layout of a program that binds `bindings` under `shape`, seen by `visibility`:
 *  the very entries its declarations (`declarations`) name, made of the same table. */
export function airLayoutEntries(
  bindings: AirBindings,
  visibility: GPUShaderStageFlags,
  shape: AirShape = DEFAULT_AIR_SHAPE,
): GPUBindGroupLayoutEntry[] {
  return boundNames(bindings, shape).flatMap((name) =>
    layoutEntry(name, visibility, bindings, shape),
  )
}

/** The group entries of a program that binds `bindings` under `shape`, made of `resources` by name:
 *  a resource the shape does not bind (a table it does not make) is left out, as the program's
 *  layout (`airLayoutEntries`) leaves it. */
export function airBindEntries(
  bindings: AirBindings,
  shape: AirShape,
  resources: Partial<Record<AirBindingName, GPUBindingResource>>,
) {
  const bound = new Set(boundNames(bindings, shape))
  const kept = Object.entries(resources).filter(([name]) => bound.has(name as AirBindingName))
  return namedEntries(AIR_BINDING, Object.fromEntries(kept))
}
