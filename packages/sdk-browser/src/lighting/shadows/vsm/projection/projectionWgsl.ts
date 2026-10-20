/**
 * The virtual shadow map projection compute pass: each opaque pixel's shadow of each light, the
 * receiver's trace (`../trace/receiverTraceWgsl.ts`) evaluated 64 pixels a workgroup, whose halves vote.
 *
 * DISPATCH. 8×8 groups, pixels in Z-order inside a group (group index → Z-order decode),
 * 32-pixel halves. The votes of the adaptive ray count (all true) act on the 8×4 halves of a group
 * (Z-order indices 0-31, 32-63), by a workgroup counter per half (`vsmProjectionVoteWgsl`, 3
 * rotating slots, one barrier per vote), or by the half's subgroup on a device whose subgroups hold
 * 32 lanes: two votes a light at most. A thread never leaves alone (the early return past the rect, the per-ray
 * `break`): every loop that votes has a uniform bound (uniform buffer values), a thread out of the
 * rect / out of the light / whose half has voted to stop keeps iterating as a no-op and votes
 * neutrally (true for all-true, false for any-true), exactly the lanes a wave excludes. The whole
 * group leaves a ray loop at once, where both its halves voted to stop (`vsmGroupVoted`).
 *
 * LIGHTS. Every shadowed light of the frame in one dispatch, up to 64 (`vsmView.lights`): light k
 * is the 8-bit lane k % 4 of the r32uint mask's layer k / 4 — the k of n rays its trace counted
 * missing (`vsmMaskCode`, decoded by `vsmMaskDecode`, `lighting/direct/shadowWgsl.ts`), 0 (= 1, lit) for the unused lanes
 * of the last layer —, each pixel's inputs read and reconstructed once for all of them. Each light
 * takes the one trace (`../trace/traceWgsl.ts`), its map telling where its rays read: one pipeline for every
 * mix of lights.
 *
 * TILES. A group's 8×8 pixels are a tile, and its work follows the lights that reach it, never the
 * frame's count: each lane bounds its lit pixel's point into the tile's box, lane k tests light k
 * against that box (`vsmLightMayReachTile`, conservative), each pixel runs the exact region test
 * (`vsmLightParticipates`) on those candidates alone, and the tile's lights are those a pixel of it
 * is in — the very set a test of every light at every pixel gives. Only a layer holding one of
 * them is stored, and the layers stored go to the tile's word (`vsmShadowMaskTiles`): the resolve
 * reads a light's lane only where its tile stored its layer (`vsmMaskFactor`,
 * `lighting/direct/shadowWgsl.ts`), every other lane being 0, its factor 1. A pixel no light
 * shades (sky, unlit, out of the rect) reads its flags and stops there: it reconstructs nothing,
 * takes no noise and decodes no receiver.
 * SURFACES. One kernel over the opaque resolve's pixels (`VSM_PROJECTION_OPAQUE_WGSL`), the whole
 * view, from the surface flags and the shadow receiver target; every translucent layer traces its
 * own shadow (`vsmTraceAt`).
 * The lights are those of the frame's plan, not the light grid's cells: the projection's point is
 * the receiver's (`shadowReceiver`), off the depth a cell's list was built for. A thin-subsurface
 * pixel gets no normal bias, no screen ray, no back-face cull.
 */
import { SUBGROUP_ALL_WGSL } from '../../../../gpu/core/subgroups.ts'
import {
  VSM_PROJECTION_OPAQUE_WGSL,
  VSM_PROJECTION_PIXEL_WGSL,
  vsmProjectionVoteWgsl,
} from './projectionPixelWgsl.ts'
import { VSM_PROJECTION_REGION_WGSL, VSM_PROJECTION_TILE_BOUND_WGSL } from './projectionTileWgsl.ts'
import { vsmProjectionEntryWgsl } from './projectionEntryWgsl.ts'
import { receiverTargetReadWgsl } from '../../../../visibility/shader/receiverTargetWgsl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import {
  bitIsSet,
  bitMask,
  bitWord,
  ceilDivWgsl,
  isFiniteWord,
  lowBits,
} from '../../../../../../math/src/wgsl/integer.ts'
import { FLOAT32_MIN_NORMAL } from '../../../../../../math/src/wgsl/constants.ts'
import { unprojectPoint, uvToNdc } from '../../../../../../math/src/wgsl/projection.ts'
import { vsmBlueNoiseTwo, vsmBlueNoiseWgsl } from '../blueNoise.ts'
import { VSM_CONSTANTS_WGSL, VSM_PROJECTION_GROUP_SIZE } from '../constants.ts'
import { VSM_PROJECTION_VIEW_STRUCT } from './projectionView.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { vsmBindingsWgsl, type VsmBindingSpec, vsmPoolLoadOf } from '../resources.ts'
import { vsmTraceLightWgsl } from '../trace/traceWgsl.ts'
import { VSM_TRACE_COMMON_WGSL } from '../trace/traceCommonWgsl.ts'
import { vsmReceiverTraceWgsl } from '../trace/receiverTraceWgsl.ts'
import { vsmTransmissionReadWgsl } from '../transmission/transmissionReadWgsl.ts'
import type { VsmLayout } from '../layout.ts'
import { localLightReaches } from '../../../direct/lightReachWgsl.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'

/** The projection's groups, a tile word each, along `pixels`. */
export const vsmProjectionGroups = (pixels: number) => ceilDiv(pixels, VSM_PROJECTION_GROUP_SIZE)
/** The projection's groups over `width` × `height` pixels. */
export const vsmProjectionTiles = (width: number, height: number) =>
  [vsmProjectionGroups(width), vsmProjectionGroups(height)] as const
/** Mask format: four lights' 8-bit lanes (`vsmMaskCode`). */
export const VSM_PROJECTION_MASK_FORMAT: GPUTextureFormat = 'r32uint'
/** Format of the mask's tile words: a texel per group, bit L where the group stored layer L. */
export const VSM_PROJECTION_TILE_FORMAT: GPUTextureFormat = 'r32uint'
/** Format of the mask's transmission: a light's colour through the panes, a layer a light. */
export const VSM_PROJECTION_THROUGH_FORMAT: GPUTextureFormat = 'rgba8unorm'

/** Group 0: the VSM tables the projection reads (bindings 4.. = the pool, slices × parts). */
export const VSM_PROJECTION_VSM_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'projectionData', binding: 2 },
  { resource: 'tileDepths', binding: 3 },
  { resource: 'pagePool', binding: 4 },
]

/** Group 1 bindings. */
export const VSM_PROJECTION_BINDING = {
  view: 0,
  sceneDepth: 1,
  normalRough: 2,
  flags: 3,
  blueNoise: 4,
  shadowMask: 5,
  shadowMaskTiles: 6,
  /** The depth pyramid: three bindings from here (`hizDepthEntries`). */
  hizDepth: 7,
  /** The translucent casters' memory (`vsmTransmissionReadWgsl`), a one-texel stand-in without. */
  transmission: 10,
  /** What the panes let through along each light's missed rays, a layer a light
   *  (`VSM_PROJECTION_THROUGH_FORMAT`), a one-texel stand-in without translucent casters. */
  shadowThrough: 11,
} as const

/** Bind group of the shadow receiver target the resolve wrote (`receiverTargetWgsl.ts`), binding 0. */
export const VSM_PROJECTION_RECEIVER_GROUP = 2

/** The view uniform and the light kind the lights' records carry (`projectionView.ts`). */
const PROJECTION_VIEW = /* wgsl */ `
${VSM_PROJECTION_VIEW_STRUCT}
`

/** The pass group's bindings: the view, the opaque resolve's depth, normals and surface flags, the
 *  mask, its tile words and its transmission. */
const BINDINGS_WGSL = /* wgsl */ `
@group(1) @binding(${VSM_PROJECTION_BINDING.view}) var<uniform> vsmView:VsmProjectionView;
@group(1) @binding(${VSM_PROJECTION_BINDING.sceneDepth}) var vsmSceneDepth:texture_depth_2d;
@group(1) @binding(${VSM_PROJECTION_BINDING.normalRough}) var vsmNormalRough:texture_2d<f32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.flags}) var vsmFlags:texture_2d<u32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.shadowMask}) var vsmShadowMask:texture_storage_2d_array<${VSM_PROJECTION_MASK_FORMAT},write>;
@group(1) @binding(${VSM_PROJECTION_BINDING.shadowMaskTiles}) var vsmShadowMaskTiles:texture_storage_2d<${VSM_PROJECTION_TILE_FORMAT},write>;
@group(1) @binding(${VSM_PROJECTION_BINDING.shadowThrough}) var vsmShadowThrough:texture_storage_2d_array<${VSM_PROJECTION_THROUGH_FORMAT},write>;`

/** The whole module, for one layout (pool parts); its halves vote over their subgroups with
 *  `subgroups` (`vsmProjectionVoteWgsl`). */
export function vsmProjectionWgsl(layout: VsmLayout, subgroups = false) {
  return wgslProgram(
    [
      PROJECTION_VIEW,
      BINDINGS_WGSL,
      vsmProjectionVoteWgsl(subgroups),
      VSM_PROJECTION_PIXEL_WGSL,
      VSM_PROJECTION_OPAQUE_WGSL,
      VSM_PROJECTION_REGION_WGSL,
      VSM_PROJECTION_TILE_BOUND_WGSL,
      vsmProjectionEntryWgsl(),
    ].join('\n'),
    [
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      vsmBindingsWgsl(0, VSM_PROJECTION_VSM_SPECS, layout),
      vsmTraceLightWgsl(),
      vsmBlueNoiseWgsl(1, VSM_PROJECTION_BINDING.blueNoise),
      VSM_TRACE_COMMON_WGSL,
      localLightReaches,
      // The traces sample this pass's pool and take the blue noise's pair; its lanes vote.
      vsmReceiverTraceWgsl({
        pool: vsmPoolLoadOf(0, VSM_PROJECTION_VSM_SPECS, layout),
        noise: vsmBlueNoiseTwo(1, VSM_PROJECTION_BINDING.blueNoise),
        hiz: [1, VSM_PROJECTION_BINDING.hizDepth],
        lone: false,
        transmission: vsmTransmissionReadWgsl(VSM_PROJECTION_BINDING.transmission, 1, true),
      }),
      uvToNdc,
      unprojectPoint,
      ceilDivWgsl,
      bitWord,
      bitMask,
      bitIsSet,
      isFiniteWord,
      lowBits,
      FLOAT32_MIN_NORMAL,
      receiverTargetReadWgsl(VSM_PROJECTION_RECEIVER_GROUP, 0),
      ...(subgroups ? [SUBGROUP_ALL_WGSL] : []),
    ],
  )
}
