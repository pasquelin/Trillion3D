import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { directShadowWgsl } from '../direct/shadowWgsl.ts'
import { TILE_SLICE_WGSL } from '../direct/lightingWgsl.ts'
import { VSM_TRACE_KINDS_BOTH } from '../shadows/vsm/trace/traceWgsl.ts'
import { skyLightDiffuseWgsl } from '../../modules/sky/skyLight/read.ts'
import { cloudShadowReadWgsl } from '../atmosphere/cloudShadowRead.ts'
import { lightFunctionReadWgsl } from '../lightFunction/readWgsl.ts'
import { volumetricLightmapWgsl } from '../volumetricLightmap/sampleWgsl.ts'
import {
  FOG_BINDING,
  FOG_PROGRAM_BINDINGS,
  type FogBindings,
  type FogProgramName,
} from './bindings.ts'
import { fogGridWgsl, FOG_CELLS_WGSL } from './gridWgsl.ts'
import { FOG_FURTHEST_WGSL, FOG_INTEGRATE_WGSL } from './integrateWgsl.ts'
import { FOG_STATIC_FORMAT } from './layout.ts'
import { FOG_FRAME_STRUCT_WGSL, fogBlockOf } from './readWgsl.ts'
import { fogScatterWgsl } from './scatterWgsl.ts'
import { FOG_STATIC_WGSL } from './staticWgsl.ts'
import { FOG_NO_SKY_VISIBILITY_WGSL, FOG_SKY_VISIBILITY_WGSL } from './skyVisibilityWgsl.ts'
import {
  FOG_VOXEL_PREPARE_WGSL,
  FOG_VOXEL_STRUCTS_WGSL,
  FOG_VOXEL_WGSL,
  fogVoxelWgsl,
} from './voxelWgsl.ts'
import type { VoxelGraphSet } from './voxelGraph.ts'

const b = FOG_BINDING

const DECLARATIONS = {
  frame: `@group(0) @binding(${b.frame}) var<uniform> frame:FogVolumeFrame;`,
  depth: `@group(0) @binding(${b.depth}) var fogDepth:texture_depth_2d;`,
  furthestOut: `@group(0) @binding(${b.furthestOut}) var fogFurthestOut:texture_storage_2d<r32float,write>;`,
  lights: `@group(0) @binding(${b.lights}) var<storage,read> directLights:DirectLights;`,
  tiles: `@group(0) @binding(${b.tiles}) var<storage,read> tileLights:array<u32>;`,
  furthest: `@group(0) @binding(${b.furthest}) var fogFurthest:texture_2d<f32>;`,
  previousFurthest: `@group(0) @binding(${b.previousFurthest}) var fogPreviousFurthest:texture_2d<f32>;`,
  previousVolume: `@group(0) @binding(${b.previousVolume}) var fogPreviousVolume:texture_3d<f32>;`,
  scattering: `@group(0) @binding(${b.scattering}) var fogScattering:texture_storage_3d<rgba16float,write>;`,
  scatterIn: `@group(0) @binding(${b.scatterIn}) var fogScatterIn:texture_3d<f32>;`,
  integrated: `@group(0) @binding(${b.integrated}) var fogIntegrated:texture_storage_3d<rgba16float,write>;`,
  voxelFrame: `@group(0) @binding(${b.voxelFrame}) var<uniform> voxelFrame:FogVoxelFrame;`,
  voxelObjects: `@group(0) @binding(${b.voxelObjects}) var<storage,read> voxelObjects:array<FogVoxelObject>;`,
  voxelSpans: `@group(0) @binding(${b.voxelSpans}) var<storage,read_write> voxelSpans:array<FogVoxelSpan>;`,
  voxelSpansRead: `@group(0) @binding(${b.voxelSpansRead}) var<storage,read> voxelSpans:array<FogVoxelSpan>;`,
  voxelOut: `@group(0) @binding(${b.voxelOut}) var fogVoxelOut:texture_storage_3d<rgba16float,write>;`,
  voxelEmitOut: `@group(0) @binding(${b.voxelEmitOut}) var fogVoxelEmitOut:texture_storage_3d<rgba16float,write>;`,
  voxelIn: `@group(0) @binding(${b.voxelIn}) var fogVoxelIn:texture_3d<f32>;`,
  voxelEmitIn: `@group(0) @binding(${b.voxelEmitIn}) var fogVoxelEmitIn:texture_3d<f32>;`,
  translucencyGi: `@group(0) @binding(${b.translucencyGi}) var fogGiVolume:texture_3d<f32>;`,
  staticOut: `@group(0) @binding(${b.staticOut}) var fogStaticOut:texture_storage_3d<${FOG_STATIC_FORMAT},write>;`,
  staticIn: `@group(0) @binding(${b.staticIn}) var fogStaticIn:texture_storage_3d<${FOG_STATIC_FORMAT},read>;`,
} as const

/** The declarations of the program that binds `bindings` (the sampler, the cubemap, the shadow
 *  maps and the pyramid are declared by the blocks that read them). */
const declarations = (bindings: FogBindings) =>
  (Object.keys(DECLARATIONS) as (keyof typeof DECLARATIONS)[])
    .filter((name) => bindings[name])
    .map((name) => DECLARATIONS[name])
    .join('\n')

/** A shadowed light's shadow, the sun's or a local light's whose `shadowsFog` is set: one sample of
 *  the light's virtual shadow map at the cell's point. */
const SHADOW = directShadowWgsl({
  vsm: {
    pageTable: b.pageTable,
    projectionData: b.projectionData,
    uniforms: b.shadowUniforms,
    pool: b.shadowPool,
  },
  trace: { view: b.shadowView, noise: 0 },
  quality: 0,
  localShadows: true,
  kinds: VSM_TRACE_KINDS_BOTH,
})

/** What the fog reads past the light buffer in the scatter: the cubemap, the sampler it and the
 *  volume before are read through, and the lists of the local fog volumes over each tile; without the
 *  lists or the volumes' code where `local` is false. */
const scatterFog = (local: boolean) =>
  fogBlockOf({
    group: 0,
    cubemap: b.cubemap,
    sampler: b.sampler,
    ...(local ? { tiles: b.localTiles } : { localFog: false }),
  })

/** The fog's text in the static term's pass: the cubemap and the sampler, and no lists of local fog
 *  volumes (it binds none: the view's own list, which it never reads, the pass reading no volume);
 *  none of the volumes' code where `local` is false. */
const staticFog = (local: boolean) =>
  fogBlockOf({
    group: 0,
    cubemap: b.cubemap,
    sampler: b.sampler,
    ...(!local && { localFog: false }),
  })

/** The light functions the scatter reads for the sun and, where the setting says, the local lights. */
const LIGHT_FUNCTION = lightFunctionReadWgsl({
  group: 0,
  atlas: b.lightFunction,
  eye: 'frame.eye.xyz',
})

/** The clouds' shade the scatter's sun is read through, by the volumes' sampler. */
const CLOUD_SHADOW = cloudShadowReadWgsl({
  group: 0,
  block: b.cloudShadow,
  map0: b.cloudShadowMap0,
  map1: b.cloudShadowMap1,
  samplerName: 'fogSampler',
})

/** The sky light the scatter's sky is read through: its harmonics. */
const SKY_LIGHT = skyLightDiffuseWgsl({ group: 0, harmonics: b.skyHarmonics, params: b.skyParams })

/** The scatter, over the sky's visibility `visibility` finds (`FOG_SKY_VISIBILITY_WGSL`, or `FOG_NO_SKY_VISIBILITY_WGSL`),
 *  with the local fog volumes' code unless `local` is false. */
const scatterProgram = (
  bindings: FogBindings,
  visibility: WgslDecl,
  local: boolean,
  sampled = false,
) =>
  wgslProgram(`${declarations(bindings)}\n`, [
    DIRECT_LIGHT_WGSL,
    TILE_SLICE_WGSL,
    SHADOW,
    FOG_FRAME_STRUCT_WGSL,
    scatterFog(local),
    LIGHT_FUNCTION,
    CLOUD_SHADOW,
    SKY_LIGHT,
    visibility,
    fogScatterWgsl(sampled),
    fogGridWgsl(local),
  ])

/** The static term's pass: the lightmap beside the sky light's read and the fog's text. */
const staticProgram = (bindings: FogBindings, local: boolean) =>
  wgslProgram(`${declarations(bindings)}\n`, [
    DIRECT_LIGHT_WGSL,
    FOG_FRAME_STRUCT_WGSL,
    staticFog(local),
    SKY_LIGHT,
    volumetricLightmapWgsl(0, b.lightmap),
    FOG_STATIC_WGSL,
  ])

/**
 * THE VOLUME'S PROGRAMS, each over the bindings it names (`bindings.ts`).
 * - `furthest`: the furthest depth around each cell of the grid across the image, read from
 *   the depth pyramid the frame builds (`FOG_FURTHEST_WGSL`);
 * - `scatter`: the light each cell scatters, blended with the previous volume (`fogScatterWgsl`), over
 *   the light buffer, the light lists, the sun's shadow — the virtual shadow maps a blended surface
 *   reads, one sample of the light's map (`directShadowWgsl`) — and the fog's cubemap;
 * - `scatterSky`: the same scatter with the global distance field bound, which finds the share of the sky each sample sees
 *   (`FOG_SKY_VISIBILITY_WGSL`, a sample at a time); made once an image asks for it, the plain `scatter` serving
 *   until then and wherever the field is not asked for;
 * - `scatterSampled`, `scatterSkySampled`: those two with the local lights lit by samples (`sampledLightsVolume`, `fogLightsWgsl`), made once an image asks for them;
 * - `static`: the baked light each cell scatters (`FOG_STATIC_WGSL`), a pass of its own before the scatter,
 *   which binds the most sampled textures a stage may: the volumetric lightmap's eight, the depth, the
 *   furthest depths and the cubemap; the scatter loads what it writes as a storage texture;
 * - `integrate`: the sum of the cells along each column (`FOG_INTEGRATE_WGSL`);
 * - `prepare` and `voxelize`: the objects of the volume material domain in the volume, before the
 *   scatter (`voxelWgsl.ts`): the slices each reaches, then the medium each cell holds of them.
 */

/** The voxelisation of the objects that wear the graphs of `set` (`voxelGraph.ts`): the plain
 *  voxelisation's text with the programs' functions, made when the set is known. */
export const fogGraphProgram = (set: VoxelGraphSet) =>
  wgslProgram(`${declarations(FOG_PROGRAM_BINDINGS.voxelize)}\n`, [
    FOG_FRAME_STRUCT_WGSL,
    fogVoxelWgsl(set),
  ])

const fogPrograms = (local: boolean) =>
  ({
    furthest: wgslProgram(`${declarations(FOG_PROGRAM_BINDINGS.furthest)}\n`, [
      FOG_FRAME_STRUCT_WGSL,
      hizDepthWgsl(0, b.hiz),
      FOG_FURTHEST_WGSL,
    ]),
    scatter: scatterProgram(FOG_PROGRAM_BINDINGS.scatter, FOG_NO_SKY_VISIBILITY_WGSL, local),
    scatterSky: scatterProgram(
      FOG_PROGRAM_BINDINGS.scatterSky,
      FOG_SKY_VISIBILITY_WGSL(b.field),
      local,
    ),
    scatterSampled: scatterProgram(
      FOG_PROGRAM_BINDINGS.scatterSampled,
      FOG_NO_SKY_VISIBILITY_WGSL,
      local,
      true,
    ),
    scatterSkySampled: scatterProgram(
      FOG_PROGRAM_BINDINGS.scatterSkySampled,
      FOG_SKY_VISIBILITY_WGSL(b.field),
      local,
      true,
    ),
    static: staticProgram(FOG_PROGRAM_BINDINGS.static, local),
    integrate: wgslProgram(`${declarations(FOG_PROGRAM_BINDINGS.integrate)}\n`, [
      FOG_FRAME_STRUCT_WGSL,
      FOG_CELLS_WGSL,
      FOG_INTEGRATE_WGSL,
    ]),
    prepare: wgslProgram(`${declarations(FOG_PROGRAM_BINDINGS.prepare)}\n`, [
      FOG_FRAME_STRUCT_WGSL,
      FOG_VOXEL_STRUCTS_WGSL,
      FOG_VOXEL_PREPARE_WGSL,
    ]),
    voxelize: wgslProgram(`${declarations(FOG_PROGRAM_BINDINGS.voxelize)}\n`, [
      FOG_FRAME_STRUCT_WGSL,
      FOG_VOXEL_WGSL,
    ]),
  }) as const satisfies Record<FogProgramName, string>

/** The programs of a session that supports the local fog volumes (the default). */
export const FOG_PROGRAMS = fogPrograms(true)

let withoutLocal: ReturnType<typeof fogPrograms> | undefined
/** The programs of a session whose project switch `localFogVolumeSupport` is off: none holds any of the local
 *  fog volumes' code. Made at the first ask. */
export const fogProgramsWithoutLocal = () => (withoutLocal ??= fogPrograms(false))
