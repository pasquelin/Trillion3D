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
 * lighting reads its lane by (`vsmMaskLaneOf`). The pass is as the suns' is: 8×8 groups, pixels in
 * Z-order, the adaptive ray count voted by the 32-pixel halves (the half's subgroup, or workgroup
 * counters), in uniform flow — the light loop runs to the longest list of the group, a pixel past its
 * own traces as a no-op and votes neutrally.
 * The shares are packed in the pixel's mask, four bits a light (`maskFormat.ts`).
 *
 * The lights are those of the frame's plan: a record each in the view uniform (`vsmView.lights`), the
 * suns' first. A thin-subsurface pixel gets no normal bias, no screen ray, no back-face cull, and lets
 * light through its shadow (`vsmSubsurfaceShadow`).
 *
 * THE INPUT TYPE (`../inputType.ts`). Both passes are one program each of the pixels they read, as the
 * reference's one shader of its input type: the opaque surfaces of the view's tiles, or the hair strands
 * over the list of all the tiles with strands (an indirect dispatch, `VSM_STRANDS_PIXEL_OF_WGSL`), the
 * strands' own masks written. A strand is spared the back-face cull (`vsmProjectionRegionWgsl`) and the
 * screen ray (`VsmTraceHost.input`), reads no thin transmission, and is moved toward each light by the
 * normal bias, the light's direction its normal (`vsmStrandReceiverOf`).
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
import { VSM_PROJECTION_SUBSURFACE_WGSL, vsmProjectionRegionWgsl } from './projectionRegionWgsl.ts'
import {
  VSM_PROJECTION_PIXEL_OF_WGSL,
  VSM_STRANDS_PIXEL_OF_WGSL,
  vsmLocalsEntryWgsl,
  vsmSunsEntryWgsl,
} from './projectionEntryWgsl.ts'
import type { VsmInputType } from '../inputType.ts'
import { FLAT_INDEX_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { HAIR_TILE_ALL, HAIR_TILE_LISTS } from '../../../../hair/visibilityMath.ts'
import { VSM_LIGHT_GRID_WGSL } from './lightGridWgsl.ts'
import { vsmProjectionPrefilteredWgsl } from './projectionPrefilteredWgsl.ts'
import { VSM_SHADOW_FILTER_WGSL } from '../trace/shadowFilterWgsl.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../../../math/src/wgsl/decl.ts'
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
import { TILE_SLICE_WGSL, pixelCellWgsl, tileSliceWgsl } from '../../../direct/lightingWgsl.ts'
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
  /** The suns' pass alone, where the set holds the prefiltered distant shadow: its merged pool
   *  (`filterableWgsl.ts`), bytes read by word. */
  filterableMerged: 6,
  /** The per-light pass alone (`perLightProjectionWgsl.ts`): the light's record (`perLightRecord.ts`), a
   *  uniform read at a dynamic offset. */
  perLight: 16,
  /** The input `strands` alone (`../inputType.ts`): the tiles' counts, a uniform, and the list of all the
   *  tiles with strands; the depth of the nearest strand takes the opaque depth's binding (`sceneDepth`). */
  strandsCounts: 17,
  strandsTiles: 18,
  /** The local lights' pass alone, where a capsule shadow casts (`capsule`): a layer a light of the frame, the share of the light the capsules let through
   *  at each pixel (`capsuleShadows/host.ts`), read where the pass packs a light's share. */
  capsule: 19,
  /** The suns', local lights' and per-light passes, where the strands cast their shadow on the surfaces by their own deep shadows or voxels (the `hair` cut): a layer a light of the frame,
   *  the share of the light the strands let through at each pixel (`hair/surfaceShadowPass.ts`), read where the pass writes a light's share. */
  hairShadow: 20,
} as const

/** The declaration of the strands' shadow layers, which a pass of the `hair` cut reads. */
export const HAIR_SHADOW_BINDING_WGSL = `
@group(1) @binding(${VSM_PROJECTION_BINDING.hairShadow}) var vsmHairShadow:texture_2d_array<f32>;`

/** The view uniform and the light kind the lights' records carry (`projectionView.ts`). */
export const PROJECTION_VIEW = /* wgsl */ `
${VSM_PROJECTION_VIEW_STRUCT}
`

/** The pass group's bindings both passes share: the view, the opaque resolve's depth, normals and
 *  surface flags, the thin transmission. */
export const BINDINGS_WGSL = /* wgsl */ `
@group(1) @binding(${VSM_PROJECTION_BINDING.view}) var<uniform> vsmView:VsmProjectionView;
@group(1) @binding(${VSM_PROJECTION_BINDING.sceneDepth}) var vsmSceneDepth:texture_depth_2d;
@group(1) @binding(${VSM_PROJECTION_BINDING.normalRough}) var vsmNormalRough:texture_2d<f32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.flags}) var vsmFlags:texture_2d<u32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.subsurface}) var subsurfaceColor:texture_storage_2d<${SUBSURFACE_FORMAT},read>;
@group(1) @binding(${VSM_PROJECTION_BINDING.lobes}) var vsmLobes:texture_storage_2d<${PHYSICAL_LOBES_FORMAT},read>;`

/** The pass group's bindings the passes of the input `strands` share: the view, the depth of the nearest
 *  strand, the tiles' counts and their list. */
const STRANDS_BINDINGS_WGSL = /* wgsl */ `
@group(1) @binding(${VSM_PROJECTION_BINDING.view}) var<uniform> vsmView:VsmProjectionView;
@group(1) @binding(${VSM_PROJECTION_BINDING.sceneDepth}) var vsmHairDepth:texture_2d<f32>;
@group(1) @binding(${VSM_PROJECTION_BINDING.strandsCounts}) var<uniform> vsmHairCounts:vec4u;
@group(1) @binding(${VSM_PROJECTION_BINDING.strandsTiles}) var<storage,read> vsmHairTiles:array<u32>;`
if (HAIR_TILE_LISTS > 4 || HAIR_TILE_ALL !== 0)
  throw new Error(
    'the strands’ projection reads the tiles’ counts as one vec4u, the list of all of them from 0',
  )

/** The local lights' pass of the input `strands` reads the cells of the shadowed lights' grid alone, the
 *  view grid's head with them (`lightGridWgsl.ts`): with the tables of group 0, the lights and the tiles'
 *  list, it holds the eight storage buffers a stage is given at least. */
const STRANDS_TILE_SLICE_WGSL = tileSliceWgsl('vsmLightGrid')

/** What the traces of a pass of `kinds` over the pixels of `input` take; the pass's halves vote
 *  (`vsmProjectionVoteWgsl`), no lane alone. */
export const traceDeps = (layout: VsmLayout, kinds: number, input: VsmInputType = 'gbuffer') => [
  vsmTraceLightWgsl(kinds),
  blueNoiseWgsl(1, VSM_PROJECTION_BINDING.blueNoise),
  VSM_TRACE_COMMON_WGSL,
  localLightReaches,
  // The traces sample this pass's pool and take the blue noise's pair.
  vsmReceiverTraceWgsl({
    pool: vsmPoolLoadOf(0, VSM_PROJECTION_VSM_SPECS, layout),
    noise: blueNoiseWgsl(1, VSM_PROJECTION_BINDING.blueNoise),
    hiz: [1, VSM_PROJECTION_BINDING.hizDepth],
    lone: false,
    kinds,
    input,
    classic: layout.classic,
  }),
]

/** The first step of a pass's kernels over the pixels of `input`. */
const pixelOfInput = (input: VsmInputType) =>
  input === 'strands' ? VSM_STRANDS_PIXEL_OF_WGSL : VSM_PROJECTION_PIXEL_OF_WGSL

export const projectionCommon = (
  layout: VsmLayout,
  pixelOf: WgslDecl = VSM_PROJECTION_PIXEL_OF_WGSL,
) => [
  VSM_CONSTANTS_WGSL,
  pixelOf,
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

/** The suns' pass for the pool `layout` over the pixels of `input` (`../inputType.ts`); its halves vote
 *  over their subgroups with `subgroups` (`vsmProjectionVoteWgsl`). With the prefiltered distant shadow
 *  (`layout.prefilteredDistant`), it binds the merged pool and samples each sun's clipmap in it before the
 *  trace. */
export function vsmSunsProjectionWgsl(
  layout: VsmLayout,
  subgroups = false,
  input: VsmInputType = 'gbuffer',
  hair = false,
) {
  const prefiltered = layout.prefilteredDistant
  const strands = input === 'strands'
  return wgslProgram(
    [
      PROJECTION_VIEW,
      strands ? STRANDS_BINDINGS_WGSL : BINDINGS_WGSL,
      `@group(1) @binding(${VSM_PROJECTION_BINDING.mask}) var vsmSunMask:texture_storage_2d_array<${VSM_SUN_MASK_FORMAT},write>;${hair ? HAIR_SHADOW_BINDING_WGSL : ''}`,
      ...(prefiltered
        ? [
            `@group(1) @binding(${VSM_PROJECTION_BINDING.filterableMerged}) var<storage,read> vsmFilterableMerged:array<u32>;
fn vsmFilterableMergedLoad(i:u32)->u32{return vsmFilterableMerged[i];}`,
          ]
        : []),
      vsmProjectionVoteWgsl(subgroups),
      VSM_PROJECTION_PIXEL_WGSL,
      ...(strands ? [] : [VSM_PROJECTION_OPAQUE_WGSL]),
      vsmProjectionRegionWgsl(input),
      VSM_PROJECTION_SUBSURFACE_WGSL,
      vsmSunsEntryWgsl(prefiltered, input, hair),
    ].join('\n'),
    [
      ...projectionCommon(layout, pixelOfInput(input)),
      ...traceDeps(layout, VSM_TRACE_KINDS_SUN, input),
      ...(subgroups ? [SUBGROUP_ALL_WGSL] : []),
      ...(strands ? [FLAT_INDEX_WGSL] : []),
      ...(prefiltered
        ? [vsmProjectionPrefilteredWgsl(vsmPoolLoadOf(0, VSM_PROJECTION_VSM_SPECS, layout))]
        : []),
    ],
  )
}

/** The local lights' pass for the pool `layout` over the pixels of `input` (`../inputType.ts`), writing a
 *  mask of `maskFormat`; its halves vote over their subgroups with `subgroups` (`vsmProjectionVoteWgsl`),
 *  as the suns' do. The strands' reads the light grid's cells in the shadowed lights' grid alone
 *  (`STRANDS_TILE_SLICE_WGSL`). */
export function vsmLocalsProjectionWgsl(
  layout: VsmLayout,
  maskFormat: ReturnType<typeof onePassMaskFormat>,
  subgroups = false,
  input: VsmInputType = 'gbuffer',
  capsule = false,
  hair = false,
) {
  const strands = input === 'strands'
  return wgslProgram(
    [
      PROJECTION_VIEW,
      strands ? STRANDS_BINDINGS_WGSL : BINDINGS_WGSL,
      `@group(1) @binding(${VSM_PROJECTION_BINDING.mask}) var vsmLocalMask:texture_storage_2d<${maskFormat},write>;
@group(1) @binding(${VSM_PROJECTION_BINDING.deferredView}) var<uniform> view:View;
@group(1) @binding(${VSM_PROJECTION_BINDING.directLights}) var<storage,read> directLights:DirectLights;${
        strands
          ? ''
          : `
@group(1) @binding(${VSM_PROJECTION_BINDING.tileLights}) var<storage,read> tileLights:array<u32>;`
      }
@group(1) @binding(${VSM_PROJECTION_BINDING.lightGrid}) var<storage,read> vsmLightGrid:array<u32>;${
        capsule
          ? `
@group(1) @binding(${VSM_PROJECTION_BINDING.capsule}) var vsmCapsule:texture_2d_array<f32>;`
          : ''
      }${hair ? HAIR_SHADOW_BINDING_WGSL : ''}`,
      vsmProjectionVoteWgsl(subgroups),
      VSM_PROJECTION_PIXEL_WGSL,
      ...(strands ? [] : [VSM_PROJECTION_OPAQUE_WGSL]),
      vsmProjectionRegionWgsl(input),
      VSM_PROJECTION_SUBSURFACE_WGSL,
      vsmLocalsEntryWgsl(subgroups, input, capsule, hair),
    ].join('\n'),
    [
      ...projectionCommon(layout, pixelOfInput(input)),
      ...traceDeps(layout, VSM_TRACE_KINDS_LOCAL, input),
      ...(subgroups ? [SUBGROUP_ALL_WGSL] : []),
      ...(strands ? [FLAT_INDEX_WGSL] : []),
      VIEW_WGSL,
      DIRECT_LIGHT_WGSL,
      strands ? STRANDS_TILE_SLICE_WGSL : TILE_SLICE_WGSL,
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
