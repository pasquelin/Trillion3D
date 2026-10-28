/**
 * THE TEXTS OF THE SAMPLED LIGHTING'S VOLUME PROGRAMS (`volumeProgram.ts` makes the pipelines of them): the sampling, in the variants of what it binds (the global distance field, the depth pyramid), and
 * the hash of the lights each tile drew.
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
  ML_NO_WORLD_BLOCKED_WGSL,
  ML_SAMPLE_WGSL,
  ML_WORLD_BLOCKED_WGSL,
} from './volumeWgsl.ts'

/** What the sampling binds, by the variant: the field and the pyramid. */
export interface VolumeVariant {
  readonly field: boolean
  readonly pyramid: boolean
}

/** The text of the sampling program of a variant. */
export const volumeSampleText = ({ field, pyramid }: VolumeVariant) =>
  wgslProgram(
    `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.tiles}) var<storage,read> tileLights:array<u32>;
@group(0) @binding(${B.samplesOut}) var mlSamplesOut:texture_storage_3d<r32uint,write>;
@group(0) @binding(${B.hashHistory}) var<storage,read> mlHashHistory:array<u32>;
@group(0) @binding(${B.ratios}) var<storage,read> mlRatios:array<u32>;
`,
    [
      DIRECT_LIGHT_WGSL,
      TILE_SLICE_WGSL,
      lightFunctionReadWgsl({ group: 0, atlas: B.lightFunction, eye: 'mlp.eye.xyz' }),
      cloudShadowReadWgsl(ML_CLOUD_SHADOW),
      ...(pyramid ? [hizDepthWgsl(0, B.hiz), FOG_FURTHEST_READ_WGSL] : [ML_NO_PYRAMID_WGSL]),
      field ? ML_WORLD_BLOCKED_WGSL(B.field) : ML_NO_WORLD_BLOCKED_WGSL,
      ML_SAMPLE_WGSL,
    ],
  )

/** The text of the hash program. */
export const volumeHashText = () =>
  wgslProgram(`@group(0) @binding(${B.hashOut}) var<storage,read_write> mlHashOut:array<u32>;\n`, [
    ML_HASH_WGSL,
  ])
