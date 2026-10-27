/**
 * The virtual shadow map projection compute passes, two, as the reference has two: each opaque pixel's
 * shadow of each light, the receiver's trace (`../trace/receiverTraceWgsl.ts`) evaluated 64 pixels a
 * workgroup.
 *
 * THE SUNS' PASS (`vsmSunsEntryWgsl`). 8×8 groups, pixels in Z-order inside a group (group index →
 * Z-order decode), 32-pixel halves. The votes of the adaptive ray count (all true) act on the 8×4 halves
 * of a group (Z-order indices 0-31, 32-63), by a workgroup counter per half (`vsmProjectionVoteWgsl`, 3
 * rotating slots, one barrier per vote), or by the half's subgroup on a device whose subgroups hold
 * 32 lanes: two votes a light at most. A thread never leaves alone (the early return past the rect, the
 * per-ray `break`): every loop that votes has a uniform bound (uniform buffer values), a thread out of
 * the rect / out of the light / whose half has voted to stop keeps iterating as a no-op and votes
 * neutrally (true for all-true, false for any-true), exactly the lanes a wave excludes. The whole
 * group leaves a ray loop at once, where both its halves voted to stop (`vsmGroupVoted`). Every sun
 * of the frame is a layer of the suns' mask (`r32float`): its shadow factor at each pixel.
 *
 * THE LOCAL LIGHTS' PASS (`vsmLocalsEntryWgsl`), one pass over the pruned light grid, which the
 * marking made (`lightGridWgsl.ts`): the shadowed lights of each cell, the lights whose map is a single page last.
 * Each pixel traces, of the shadowed lights of its own cell — the cell the lighting walks
 * (`pixelCell`) —, up to `shadowOnePassProjectionMaxLightsPerPixel` of them, in that order, which the
 * lighting reads its lane by (`vsmMaskLaneOf`), each trace on its own lane
 * (`lone`: the votes are over the active lanes of the subgroup where the device grants subgroups).
 * The shares are packed in the pixel's mask, four bits a light (`maskFormat.ts`).
 *
 * The lights are those of the frame's plan: a record each in the view uniform (`vsmView.lights`), the
 * suns' first. A thin-subsurface pixel gets no normal bias, no screen ray, no back-face cull, and lets
 * light through its shadow (`vsmSubsurfaceShadow`).
 */
import { SUBSURFACE_FORMAT } from '../../../../materials/surface/subsurface.ts'
import { vsmSubsurfaceModel, vsmTransmitsShadow } from '../subsurfaceModelWgsl.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../../../materials/surface/physicalLobes.ts'
import { LOBE_AXIS_WGSL } from '../../../lobeAxisWgsl.ts'
import { subsurfaceDensity } from '../../../subsurfaceDensity.ts'
import { isFirstPerson } from '../../../../materials/surface/surfaceModel.ts'
import { SUBGROUP_ALL_WGSL } from '../../../../gpu/core/subgroups.ts'
import {
  VSM_PROJECTION_OPAQUE_WGSL,
  VSM_PROJECTION_PIXEL_WGSL,
  vsmProjectionVoteWgsl,
} from './projectionPixelWgsl.ts'
import {
  VSM_PROJECTION_REGION_WGSL,
  VSM_PROJECTION_SUBSURFACE_WGSL,
} from './projectionRegionWgsl.ts'
import {
  VSM_PROJECTION_PIXEL_OF_WGSL,
  vsmLocalsEntryWgsl,
  vsmSunsEntryWgsl,
} from './projectionEntryWgsl.ts'
import { VSM_LIGHT_GRID_WGSL } from './lightGridWgsl.ts'
import { VSM_SHADOW_FILTER_WGSL } from '../trace/shadowFilterWgsl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { ceilDivWgsl, zOrderDecode } from '../../../../../../math/src/wgsl/integer.ts'
import { unprojectPoint, uvToNdc } from '../../../../../../math/src/wgsl/projection.ts'
import { blueNoiseWgsl } from '../../../../gpu/noise/blueNoiseWgsl.ts'
import { VSM_CONSTANTS_WGSL, VSM_PROJECTION_GROUP_SIZE } from '../constants.ts'
import { VSM_PROJECTION_VIEW_STRUCT } from './projectionView.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { vsmBindingsWgsl, type VsmBindingSpec, vsmPoolLoadOf } from '../resources.ts'
import {
  VSM_TRACE_KINDS_LOCAL,
  VSM_TRACE_KINDS_SUN,
  vsmTraceLightWgsl,
} from '../trace/traceWgsl.ts'
import { VSM_TRACE_COMMON_WGSL } from '../trace/traceCommonWgsl.ts'
import { vsmReceiverTraceWgsl } from '../trace/receiverTraceWgsl.ts'
import type { VsmLayout } from '../layout.ts'
import { localLightReaches } from '../../../direct/lightReachWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../../direct/lightWgsl.ts'
import { TILE_SLICE_WGSL, pixelCellWgsl } from '../../../direct/lightingWgsl.ts'
import { SHADOW_SLICE_WGSL } from '../../../direct/shadowSlice.ts'
import { VIEW_WGSL } from '../../../deferred/worldAtWgsl.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { VSM_OVERFLOW_WGSL } from '../overflowWgsl.ts'
import { ONE_PASS_MASK_WGSL, type onePassMaskFormat, VSM_SUN_MASK_FORMAT } from './maskFormat.ts'

/** The projection's groups along `pixels`. */
export const vsmProjectionGroups = (pixels: number) => ceilDiv(pixels, VSM_PROJECTION_GROUP_SIZE)

/** Group 0: the VSM tables the projection reads, the overflow flags the local lights' pass sets
 *  (`VSM_OVERFLOW_ONE_PASS_MAX_LIGHTS`), then the pool (bindings 4.., slices × parts). */
export const VSM_PROJECTION_VSM_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'projectionData', binding: 2 },
  { resource: 'stats', binding: 3, access: 'atomic' },
  { resource: 'pagePool', binding: 4 },
]

/** Group 1 bindings. */
export const VSM_PROJECTION_BINDING = {
  view: 0,
  sceneDepth: 1,
  normalRough: 2,
  flags: 3,
  blueNoise: 4,
  /** The pass's output: the suns' mask array, or the local lights' mask. */
  mask: 5,
  /** The depth pyramid: three bindings from here (`hizDepthEntries`). */
  hizDepth: 7,
  /** The thin transmission's target, whose alpha is the opacity of a receiver that lets light through
   *  its shadow (`vsmTransmitsShadow`): read by load, a placeholder where no surface is thin. */
  subsurface: 10,
  /** The lobes target, whose coat factor marks a clear-coated receiver (`vsmCoatedAt`): read by load, a
   *  placeholder where no surface carries a lobe. */
  lobes: 15,
  /** The local lights' pass alone: the engine's deferred view (the light grid's cells), the lights and
   *  the grid's lists. */
  deferredView: 11,
  directLights: 12,
  tileLights: 13,
  /** The shadowed lights' grid (`lightGridWgsl.ts`), which the marking's pruning wrote: the pass reads it. */
  lightGrid: 14,
} as const

/** The view uniform and the light kind the lights' records carry (`projectionView.ts`). */
const PROJECTION_VIEW = /* wgsl */ `
${VSM_PROJECTION_VIEW_STRUCT}
`

/** The pass group's bindings both passes share: the view, the opaque resolve's depth, normals and
 *  surface flags, the thin transmission. */
const BINDINGS_WGSL = /* wgsl */ `
@group(1) @binding(${VSM_PROJECTION_BINDING.view}) var<uniform> vsmView:VsmProjectionView;
@group(1) @binding(${VSM_PROJECTION_BINDING.sceneDepth}) var vsmSceneDepth:texture_depth_2d;
@group(1) @binding(${VSM_PROJECTION_BINDING.normalRough}) var vsmNormalRough:texture_2d<f32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.flags}) var vsmFlags:texture_2d<u32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.subsurface}) var subsurfaceColor:texture_storage_2d<${SUBSURFACE_FORMAT},read>;
@group(1) @binding(${VSM_PROJECTION_BINDING.lobes}) var vsmLobes:texture_storage_2d<${PHYSICAL_LOBES_FORMAT},read>;`

/** What the traces of a pass of `kinds` take, `lone` where a lane votes alone (`subgroups`: over its
 *  subgroup). */
const traceDeps = (layout: VsmLayout, kinds: number, lone: boolean, subgroups: boolean) => [
  vsmTraceLightWgsl(kinds),
  blueNoiseWgsl(1, VSM_PROJECTION_BINDING.blueNoise),
  VSM_TRACE_COMMON_WGSL,
  localLightReaches,
  // The traces sample this pass's pool and take the blue noise's pair.
  vsmReceiverTraceWgsl({
    pool: vsmPoolLoadOf(0, VSM_PROJECTION_VSM_SPECS, layout),
    noise: blueNoiseWgsl(1, VSM_PROJECTION_BINDING.blueNoise),
    hiz: [1, VSM_PROJECTION_BINDING.hizDepth],
    lone,
    subgroups,
    kinds,
  }),
]

const common = (layout: VsmLayout) => [
  VSM_CONSTANTS_WGSL,
  VSM_PROJECTION_PIXEL_OF_WGSL,
  VSM_PROJECTION_DATA_WGSL,
  vsmBindingsWgsl(0, VSM_PROJECTION_VSM_SPECS, layout),
  vsmSubsurfaceModel,
  vsmTransmitsShadow,
  LOBE_AXIS_WGSL,
  isFirstPerson,
  uvToNdc,
  unprojectPoint,
  zOrderDecode,
  subsurfaceDensity,
]

/** The suns' pass for the pool `layout`; its halves vote over their subgroups with `subgroups`
 *  (`vsmProjectionVoteWgsl`). */
export function vsmSunsProjectionWgsl(layout: VsmLayout, subgroups = false) {
  return wgslProgram(
    [
      PROJECTION_VIEW,
      BINDINGS_WGSL,
      `@group(1) @binding(${VSM_PROJECTION_BINDING.mask}) var vsmSunMask:texture_storage_2d_array<${VSM_SUN_MASK_FORMAT},write>;`,
      vsmProjectionVoteWgsl(subgroups),
      VSM_PROJECTION_PIXEL_WGSL,
      VSM_PROJECTION_OPAQUE_WGSL,
      VSM_PROJECTION_REGION_WGSL,
      VSM_PROJECTION_SUBSURFACE_WGSL,
      vsmSunsEntryWgsl(),
    ].join('\n'),
    [
      ...common(layout),
      ...traceDeps(layout, VSM_TRACE_KINDS_SUN, false, false),
      ...(subgroups ? [SUBGROUP_ALL_WGSL] : []),
    ],
  )
}

/** The local lights' pass for the pool `layout`, writing a mask of `maskFormat`; its traces vote over
 *  their subgroups with `subgroups`. */
export function vsmLocalsProjectionWgsl(
  layout: VsmLayout,
  maskFormat: ReturnType<typeof onePassMaskFormat>,
  subgroups = false,
) {
  return wgslProgram(
    [
      PROJECTION_VIEW,
      BINDINGS_WGSL,
      `@group(1) @binding(${VSM_PROJECTION_BINDING.mask}) var vsmLocalMask:texture_storage_2d<${maskFormat},write>;
@group(1) @binding(${VSM_PROJECTION_BINDING.deferredView}) var<uniform> view:View;
@group(1) @binding(${VSM_PROJECTION_BINDING.directLights}) var<storage,read> directLights:DirectLights;
@group(1) @binding(${VSM_PROJECTION_BINDING.tileLights}) var<storage,read> tileLights:array<u32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.lightGrid}) var<storage,read> vsmLightGrid:array<u32>;`,
      VSM_PROJECTION_PIXEL_WGSL,
      VSM_PROJECTION_OPAQUE_WGSL,
      VSM_PROJECTION_REGION_WGSL,
      VSM_PROJECTION_SUBSURFACE_WGSL,
      vsmLocalsEntryWgsl(),
    ].join('\n'),
    [
      ...common(layout),
      ...traceDeps(layout, VSM_TRACE_KINDS_LOCAL, true, subgroups),
      VIEW_WGSL,
      DIRECT_LIGHT_WGSL,
      TILE_SLICE_WGSL,
      pixelCellWgsl(),
      SHADOW_SLICE_WGSL,
      VSM_LIGHT_GRID_WGSL,
      ONE_PASS_MASK_WGSL,
      VSM_OVERFLOW_WGSL,
      VSM_SHADOW_FILTER_WGSL,
      ceilDivWgsl,
    ],
  )
}
