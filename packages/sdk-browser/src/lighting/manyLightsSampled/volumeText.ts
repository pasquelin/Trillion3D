/**
 * THE TEXTS OF THE SAMPLED LIGHTING'S VOLUME PROGRAMS (`volumeProgram.ts` makes the pipelines of them): the sampling, in the variants of what it binds (the depth pyramid), the trace of the marked
 * samples through the global distance field, and the hash of the lights each tile drew.
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { TILE_SLICE_WGSL } from '../direct/lightingWgsl.ts'
import { FOG_FURTHEST_READ_WGSL } from '../fog/integrateWgsl.ts'
import { cloudShadowReadWgsl } from '../atmosphere/cloudShadowRead.ts'
import { lightFunctionReadWgsl } from '../lightFunction/readWgsl.ts'
import { ML_BINDING as B, ML_CLOUD_SHADOW } from './volumeBindings.ts'
import {
  ML_HASH_WGSL,
  ML_NO_PYRAMID_WGSL,
  ML_SAMPLE_WGSL,
  ML_WORLD_BLOCKED_WGSL,
} from './volumeWgsl.ts'
import { ML_TRACE_WGSL, VOLUME_TRACE_BINDINGS } from './volumeTraceWgsl.ts'

/** The text of the sampling program, with or without the depth pyramid. */
export const volumeSampleText = (pyramid: boolean) =>
  wgslProgram(
    `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.tiles}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.samplesOut}) var mlSamplesOut:texture_storage_3d<r32uint,write>;
@group(0) @binding(${B.raysOut}) var mlRaysOut:texture_storage_3d<r32uint,write>;
@group(0) @binding(${B.hashHistory}) var<storage,read> mlHashHistory:array<u32>;
@group(0) @binding(${B.ratios}) var<storage,read> mlRatios:array<u32>;
`,
    [
      DIRECT_LIGHT_WGSL,
      TILE_SLICE_WGSL,
      lightFunctionReadWgsl({ group: 0, atlas: B.lightFunction, eye: 'mlp.eye.xyz' }),
      cloudShadowReadWgsl(ML_CLOUD_SHADOW),
      ...(pyramid ? [hizDepthWgsl(0, B.hiz), FOG_FURTHEST_READ_WGSL] : [ML_NO_PYRAMID_WGSL]),
      ML_SAMPLE_WGSL,
    ],
  )

/** The text of the trace program of the marked samples. */
export const volumeTraceText = () =>
  wgslProgram(VOLUME_TRACE_BINDINGS, [
    DIRECT_LIGHT_WGSL,
    ML_WORLD_BLOCKED_WGSL(B.field),
    ML_TRACE_WGSL,
  ])

/** The text of the hash program. */
export const volumeHashText = () =>
  wgslProgram(`@group(0) @binding(${B.hashOut}) var<storage,read_write> mlHashOut:array<u32>;\n`, [
    ML_HASH_WGSL,
  ])
