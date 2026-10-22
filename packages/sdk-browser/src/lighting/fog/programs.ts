import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { directShadowWgsl } from '../direct/shadowWgsl.ts'
import { TILE_SLICE_WGSL } from '../direct/lightingWgsl.ts'
import { VSM_TRACE_KINDS_SUN } from '../shadows/vsm/trace/traceWgsl.ts'
import { FOG_GRID_WGSL, FOG_CELLS_WGSL } from './gridWgsl.ts'
import { FOG_FURTHEST_WGSL, FOG_INTEGRATE_WGSL } from './integrateWgsl.ts'
import { FOG_FRAME_STRUCT_WGSL, fogBlockOf } from './readWgsl.ts'
import { FOG_SCATTER_WGSL } from './scatterWgsl.ts'

/**
 * THE VOLUME'S THREE PROGRAMS and where each binds what it reads and writes, in group 0: one table
 * of numbers, so the passes and their shaders agree (`passes.ts`). A program binds only what it names.
 * - `furthest`: the furthest depth around each cell of the grid across the image, read from
 *   the depth pyramid the frame builds (`FOG_FURTHEST_WGSL`);
 * - `scatter`: the light each cell scatters, blended with the previous volume (`FOG_SCATTER_WGSL`), over
 *   the light buffer, the light lists, the sun's shadow — the virtual shadow maps a blended surface
 *   reads, one sample of the light's map (`directShadowWgsl`) — and the fog's cubemap;
 * - `integrate`: the sum of the cells along each column (`FOG_INTEGRATE_WGSL`).
 */
export const FOG_BINDING = {
  /** The light buffer, read. */
  lights: 0,
  /** The light lists of the light grid (`tileLights`), read. */
  tiles: 1,
  /** The frame (`FOG_VOLUME_FRAME`), a uniform. */
  frame: 2,
  /** The scene's depth, read by the scatter. */
  depth: 3,
  /** This image's furthest depth, read by the scatter. */
  furthest: 4,
  /** The previous image's furthest depth. */
  previousFurthest: 5,
  /** The previous volume the scatter blends in. */
  previousVolume: 6,
  /** The sampler the volumes are read through: linear, clamped. */
  sampler: 7,
  /** The volume the scatter writes, a storage texture. */
  scattering: 8,
  /** The integrated volume, written. */
  integrated: 9,
  /** The furthest depth, written. */
  furthestOut: 10,
  /** The scatter's volume, which the integration reads. */
  scatterIn: 11,
  /** The fog's cubemap, a cube texture (`createFogCubemap`). */
  cubemap: 12,
  /** The virtual shadow maps the sun's shadow reads: the page table, the projection data, the
   *  uniforms, the pool's first slice, and the projection's view. */
  pageTable: 13,
  projectionData: 14,
  shadowUniforms: 15,
  shadowPool: 16,
  shadowView: 17,
  /** The depth pyramid the furthest depth is read from (`hizDepthWgsl`): three bindings from this one. */
  hiz: 18,
} as const

/** What a program binds, by name. */
export type FogBindings = Partial<Record<keyof typeof FOG_BINDING, true>>

const b = FOG_BINDING

/** The bindings of the three programs. */
export const FOG_PROGRAM_BINDINGS = {
  furthest: { frame: true, hiz: true, furthestOut: true },
  scatter: {
    lights: true,
    tiles: true,
    frame: true,
    depth: true,
    furthest: true,
    previousFurthest: true,
    previousVolume: true,
    sampler: true,
    scattering: true,
    cubemap: true,
    pageTable: true,
    projectionData: true,
    shadowUniforms: true,
    shadowPool: true,
    shadowView: true,
  },
  integrate: { frame: true, scatterIn: true, integrated: true },
} as const satisfies Record<string, FogBindings>

/** A program of the volume. */
export type FogProgramName = keyof typeof FOG_PROGRAM_BINDINGS

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
} as const

/** The declarations of the program that binds `bindings` (the sampler, the cubemap, the shadow
 *  maps and the pyramid are declared by the blocks that read them). */
const declarations = (bindings: FogBindings) =>
  (Object.keys(DECLARATIONS) as (keyof typeof DECLARATIONS)[])
    .filter((name) => bindings[name])
    .map((name) => DECLARATIONS[name])
    .join('\n')

/** The sun's shadow: one sample of the light's virtual shadow map at the cell's point. */
const SHADOW = directShadowWgsl(0, {
  vsm: {
    pageTable: b.pageTable,
    projectionData: b.projectionData,
    uniforms: b.shadowUniforms,
    pool: b.shadowPool,
  },
  trace: { view: b.shadowView, noise: 0 },
  quality: 0,
  localShadows: false,
  kinds: VSM_TRACE_KINDS_SUN,
})

/** What the fog reads past the light buffer in the scatter: the cubemap, and the sampler it and the
 *  volume before are read through. */
const SCATTER_FOG = fogBlockOf({ group: 0, cubemap: b.cubemap, sampler: b.sampler })

/** The WGSL of each program. */
export const FOG_PROGRAMS = {
  furthest: wgslProgram(`${declarations(FOG_PROGRAM_BINDINGS.furthest)}\n`, [
    FOG_FRAME_STRUCT_WGSL,
    hizDepthWgsl(0, b.hiz),
    FOG_FURTHEST_WGSL,
  ]),
  scatter: wgslProgram(`${declarations(FOG_PROGRAM_BINDINGS.scatter)}\n`, [
    DIRECT_LIGHT_WGSL,
    TILE_SLICE_WGSL,
    SHADOW,
    FOG_FRAME_STRUCT_WGSL,
    SCATTER_FOG,
    FOG_SCATTER_WGSL,
    FOG_GRID_WGSL,
  ]),
  integrate: wgslProgram(`${declarations(FOG_PROGRAM_BINDINGS.integrate)}\n`, [
    FOG_FRAME_STRUCT_WGSL,
    FOG_CELLS_WGSL,
    FOG_INTEGRATE_WGSL,
  ]),
} as const satisfies Record<FogProgramName, string>
