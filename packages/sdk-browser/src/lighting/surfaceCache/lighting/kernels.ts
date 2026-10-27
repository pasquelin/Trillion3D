import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import { skyLightReadLayoutEntries } from '../../../modules/sky/skyLight/read.ts'
import { cloudShadowLayoutEntries } from '../../atmosphere/cloudShadowRead.ts'
import { globalReadLayoutEntries } from '../../distanceField/view.ts'
import { lightFunctionLayoutEntry } from '../../lightFunction/bindings.ts'
import { sceneTraceLayoutEntries } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import { surfaceCacheReadLayoutEntries } from '../sampleWgsl.ts'
import { COMBINE_BINDINGS, COMBINE_ENTRIES, combineWgsl } from './combineWgsl.ts'
import {
  CONTEXT_ENTRIES,
  CONTEXT_FEEDBACK_BINDING,
  CONTEXT_PAGE_ARGS_BINDING,
  CONTEXT_TRACES_BINDING,
  CONTEXT_WGSL,
  SPLICE_CONTEXT_BINDING,
  SPLICE_ENTRIES,
  SPLICE_WGSL,
} from './contextWgsl.ts'
import { CULL_BINDINGS, CULL_ENTRY, cullWgsl } from './cullWgsl.ts'
import {
  LIGHT_TILE_COMPACT_BINDINGS,
  LIGHT_TILE_COMPACT_ENTRY,
  LIGHT_TILE_COMPACT_WGSL,
  LIGHT_TILE_COUNTS_BINDINGS,
  LIGHT_TILE_COUNTS_ENTRIES,
  LIGHT_TILE_COUNTS_WGSL,
} from './lightTilesWgsl.ts'
import {
  DIRECT_BINDINGS,
  DIRECT_CLOUD_SHADOW,
  DIRECT_COLOURED_WGSL,
  DIRECT_ENTRIES,
  DIRECT_WGSL,
} from './directWgsl.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { createKernel, type Kernel } from '../kernel.ts'
import {
  RADIOSITY_BUILD_BINDINGS,
  RADIOSITY_BUILD_ENTRIES,
  RADIOSITY_BUILD_WGSL,
} from './radiosityBuildWgsl.ts'
import {
  RADIOSITY_FILTER_BINDINGS,
  RADIOSITY_FILTER_ENTRIES,
  RADIOSITY_FILTER_WGSL,
} from './radiosityFilterWgsl.ts'
import {
  RADIOSITY_INTEGRATE_BINDINGS,
  RADIOSITY_INTEGRATE_ENTRY,
  RADIOSITY_INTEGRATE_WGSL,
} from './radiosityIntegrateWgsl.ts'
import {
  TILE_DEPTH_RANGE_BINDINGS,
  TILE_DEPTH_RANGE_ENTRY,
  TILE_DEPTH_RANGE_WGSL,
} from './tileDepthRangeWgsl.ts'
import {
  SHADOW_MASK_BINDINGS,
  SHADOW_MASK_CLOUD_SHADOW,
  SHADOW_MASK_ENTRIES,
  SHADOW_MASK_COLOURED_PROGRAM_WGSL,
  SHADOW_MASK_PROGRAM_WGSL,
} from './shadowMaskWgsl.ts'
import {
  SHADOW_ARGS_BINDINGS,
  SHADOW_ARGS_ENTRY,
  SHADOW_ARGS_WGSL,
  SHADOW_TRACE_BINDINGS,
  SHADOW_TRACE_ENTRY,
  SHADOW_TRACE_COLOURED_WGSL,
  SHADOW_TRACE_SCENE,
  SHADOW_TRACE_WGSL,
} from './shadowTraceWgsl.ts'
import {
  RADIOSITY_TRACE_BINDINGS,
  RADIOSITY_TRACE_ENTRY,
  RADIOSITY_TRACE_UNREAD,
  RADIOSITY_TRACE_WGSL,
  RADIOSITY_TRACED_BINDINGS,
  RADIOSITY_TRACED_SCENE,
  RADIOSITY_TRACED_UNREAD,
  RADIOSITY_TRACED_WGSL,
} from './radiosityTraceWgsl.ts'

/**
 * THE LIGHTING'S KERNELS ON THE GPU: the pipeline and the bind group layout of each program (`contextWgsl.ts`,
 * `tileDepthRangeWgsl.ts`, `cullWgsl.ts`, `lightTilesWgsl.ts`, `directWgsl.ts`, `combineWgsl.ts`, `radiosityBuildWgsl.ts`, `radiosityTraceWgsl.ts`,
 * `radiosityFilterWgsl.ts`, `radiosityIntegrateWgsl.ts`, and the traced shadows' `shadowMaskWgsl.ts` and
 * `shadowTraceWgsl.ts`), compiled off the frame, and the bind group of an image, made again
 * only when a resource it names moved. The programs that do not depend on the shape are made once for a device
 * (`staticKernels`), those that cast rays through the scene's triangles — the traced shadows' and the radiosity's, whose
 * `radiosityTraceWgsl.ts` has a second program for them — once a scene has acceleration structures and each is traced (`tracedShadowKernels`,
 * `tracedRadiosityKernels`); the cull is
 * made for the lights a tile keeps and the combine for the atlas's kind of emission layer (`shapedKernels`). The programs that read
 * or write the shadow masks are made for the format of the masks, the light functions' atlas's (`fixedKernels`, `tracedShadowKernels`).
 */

const ro = 'read-only-storage' as const
const sampled = (binding: number, type: GPUTextureSampleType = 'float') =>
  computeTextureEntry(binding, type)
const writes = (binding: number, format: GPUTextureFormat) =>
  computeStorageTextureEntry(binding, format)
const readWrites = (binding: number, format: GPUTextureFormat) =>
  computeStorageTextureEntry(binding, format, 'read-write')

/** The bindings 3 and 4 of the programs that read the depth and the normal alone. */
const depthAndNormal = (depth: number, normal: number) => [sampled(depth, 'uint'), sampled(normal)]

/** What the radiosity's programs read the blue noise by. */
const noise = (binding: number) => sampled(binding)

/** The context's programs. */
function contextKernels(device: GPUDevice, constants: ReturnType<typeof groupWidthConstants>) {
  const T = TILE_DEPTH_RANGE_BINDINGS
  return {
    context: createKernel(
      device,
      'context',
      CONTEXT_WGSL,
      CONTEXT_ENTRIES,
      [
        computeBufferEntry(1, 'storage'),
        computeBufferEntry(2, 'storage'),
        computeBufferEntry(CONTEXT_TRACES_BINDING, 'storage'),
        computeBufferEntry(CONTEXT_FEEDBACK_BINDING, ro),
        computeBufferEntry(CONTEXT_PAGE_ARGS_BINDING, 'storage'),
      ],
      { constants },
    ),
    splice: createKernel(device, 'splice', SPLICE_WGSL, SPLICE_ENTRIES, [
      computeBufferEntry(1, ro),
      computeBufferEntry(SPLICE_CONTEXT_BINDING, 'storage'),
    ]),
    lightTileCounts: createKernel(
      device,
      'light tile counts',
      LIGHT_TILE_COUNTS_WGSL,
      LIGHT_TILE_COUNTS_ENTRIES,
      [
        computeBufferEntry(LIGHT_TILE_COUNTS_BINDINGS.counts, 'storage'),
        computeBufferEntry(LIGHT_TILE_COUNTS_BINDINGS.args, 'storage'),
      ],
      { constants },
    ),
    lightTileCompact: createKernel(
      device,
      'light tile compaction',
      LIGHT_TILE_COMPACT_WGSL,
      [LIGHT_TILE_COMPACT_ENTRY],
      [
        computeBufferEntry(LIGHT_TILE_COMPACT_BINDINGS.counts, 'storage'),
        computeBufferEntry(LIGHT_TILE_COMPACT_BINDINGS.context, ro),
        computeBufferEntry(LIGHT_TILE_COMPACT_BINDINGS.tables, ro),
        computeBufferEntry(LIGHT_TILE_COMPACT_BINDINGS.culled, ro),
        computeBufferEntry(LIGHT_TILE_COMPACT_BINDINGS.compacted, 'storage'),
        computeBufferEntry(LIGHT_TILE_COMPACT_BINDINGS.cardTileOffsets, ro),
        computeBufferEntry(LIGHT_TILE_COMPACT_BINDINGS.cardTileLights, 'storage'),
      ],
    ),
    tileDepthRanges: createKernel(
      device,
      'tile depth ranges',
      TILE_DEPTH_RANGE_WGSL,
      [TILE_DEPTH_RANGE_ENTRY],
      [
        computeBufferEntry(T.tables, ro),
        computeBufferEntry(T.context, ro),
        ...depthAndNormal(T.depth, T.normal),
        computeBufferEntry(T.ranges, 'storage'),
      ],
    ),
  }
}

/** The layout entries of the cards' tables at `tables` and the atlas's layers a program reads, those in `unread` left out. */
const cardLayoutEntries = (tables: number, unread: readonly number[]) =>
  surfaceCacheReadLayoutEntries(tables, { feedback: false, compressed: false }).filter(
    ({ binding }) => !unread.includes(binding),
  )

/** The radiosity's programs that build the rays and trace them. */
function radiosityTraceKernels(
  device: GPUDevice,
  constants: ReturnType<typeof groupWidthConstants>,
) {
  const R = RADIOSITY_BUILD_BINDINGS
  const T = RADIOSITY_TRACE_BINDINGS
  return {
    radiosityBuild: createKernel(
      device,
      'radiosity tiles',
      RADIOSITY_BUILD_WGSL,
      RADIOSITY_BUILD_ENTRIES,
      [
        computeBufferEntry(R.tables, ro),
        computeBufferEntry(R.context, 'storage'),
        ...depthAndNormal(R.depth, R.normal),
      ],
      { constants },
    ),
    radiosityTrace: createKernel(
      device,
      'radiosity trace',
      RADIOSITY_TRACE_WGSL,
      [RADIOSITY_TRACE_ENTRY],
      [
        ...cardLayoutEntries(T.tables, RADIOSITY_TRACE_UNREAD),
        computeBufferEntry(T.context, ro),
        writes(T.out, 'r32uint'),
        computeBufferEntry(T.lights, ro),
        ...skyLightReadLayoutEntries(T.sky, COMPUTE),
        ...globalReadLayoutEntries(T.field),
        computeBufferEntry(T.grid, ro),
        computeBufferEntry(T.instances, ro),
        noise(T.noise),
      ],
    ),
  }
}

/** The radiosity's programs that filter the rays and integrate them. */
function radiosityShadeKernels(device: GPUDevice) {
  const F = RADIOSITY_FILTER_BINDINGS
  const I = RADIOSITY_INTEGRATE_BINDINGS
  return {
    radiosityFilter: createKernel(
      device,
      'radiosity filter',
      RADIOSITY_FILTER_WGSL,
      RADIOSITY_FILTER_ENTRIES,
      [
        computeBufferEntry(F.tables, ro),
        computeBufferEntry(F.context, ro),
        ...depthAndNormal(F.depth, F.normal),
        noise(F.noise),
        sampled(F.trace, 'uint'),
        computeBufferEntry(F.filtered, 'storage'),
        computeStorageTextureEntry(F.harmonics, 'rgba16float', 'write-only', '2d-array'),
        sampled(F.hits, 'unfilterable-float'),
      ],
    ),
    radiosityIntegrate: createKernel(
      device,
      'radiosity integrate',
      RADIOSITY_INTEGRATE_WGSL,
      [RADIOSITY_INTEGRATE_ENTRY],
      [
        computeBufferEntry(I.tables, ro),
        computeBufferEntry(I.context, ro),
        ...depthAndNormal(I.depth, I.normal),
        computeTextureEntry(I.harmonics, 'float', '2d-array'),
        readWrites(I.indirect, 'r32uint'),
        readWrites(I.frames, 'r32uint'),
        sampled(I.hits, 'unfilterable-float'),
      ],
    ),
  }
}

/** The programs that do not depend on the shape, made once for the device. */
const staticKernels = oncePerDevice((device: GPUDevice) => {
  const constants = groupWidthConstants(groupWidth(device.limits))
  return {
    ...contextKernels(device, constants),
    ...radiosityTraceKernels(device, constants),
    ...radiosityShadeKernels(device),
  }
})

/** The direct light's program over masks in `format`, made once for the device. */
const directKernelOf = {
  grey: oncePerDevice((device: GPUDevice) => directKernel(device, DIRECT_WGSL)),
  colour: oncePerDevice((device: GPUDevice) => directKernel(device, DIRECT_COLOURED_WGSL)),
}

function directKernel(device: GPUDevice, code: string) {
  const D = DIRECT_BINDINGS
  return createKernel(device, 'direct light', code, DIRECT_ENTRIES, [
    computeBufferEntry(D.tables, ro),
    computeBufferEntry(D.context, ro),
    ...depthAndNormal(D.depth, D.normal),
    computeBufferEntry(D.cardTileLights, ro),
    writes(D.out, 'r32uint'),
    computeBufferEntry(D.lights, ro),
    lightFunctionLayoutEntry(D.lightFunction),
    ...cloudShadowLayoutEntries(DIRECT_CLOUD_SHADOW, COMPUTE),
    ...globalReadLayoutEntries(D.field),
    computeBufferEntry(D.masks, ro),
    computeBufferEntry(D.factors, 'storage'),
    computeBufferEntry(D.cardTileOffsets, ro),
  ])
}

/** The programs of an image whose light functions' atlas has the format `format`: those that do not depend on the shape
 *  (`staticKernels`) and the direct light's, which reads the masks in that format. */
export const fixedKernels = (device: GPUDevice, format: AtlasFormat) => ({
  ...staticKernels(device),
  direct: directKernelOf[format](device),
})

const shadowArgsKernel = oncePerDevice((device: GPUDevice) => {
  const A = SHADOW_ARGS_BINDINGS
  return createKernel(
    device,
    'shadow trace arguments',
    SHADOW_ARGS_WGSL,
    [SHADOW_ARGS_ENTRY],
    [
      computeBufferEntry(A.tables, ro),
      computeBufferEntry(A.context, 'storage'),
      computeBufferEntry(A.traces, ro),
    ],
    { constants: groupWidthConstants(groupWidth(device.limits)) },
  )
})

/** The masks and the trace over masks in the grey format, and in the colour one. */
const MASK_PROGRAMS = {
  grey: { mask: SHADOW_MASK_PROGRAM_WGSL, trace: SHADOW_TRACE_WGSL },
  colour: { mask: SHADOW_MASK_COLOURED_PROGRAM_WGSL, trace: SHADOW_TRACE_COLOURED_WGSL },
} as const satisfies Record<AtlasFormat, { mask: string; trace: string }>

function shadowKernels(device: GPUDevice, format: AtlasFormat) {
  const M = SHADOW_MASK_BINDINGS
  const T = SHADOW_TRACE_BINDINGS
  const programs = MASK_PROGRAMS[format]
  return {
    shadowMask: createKernel(device, 'shadow masks', programs.mask, SHADOW_MASK_ENTRIES, [
      computeBufferEntry(M.tables, ro),
      computeBufferEntry(M.counts, ro),
      ...depthAndNormal(M.depth, M.normal),
      computeBufferEntry(M.lightTiles, ro),
      computeBufferEntry(M.masks, 'storage'),
      computeBufferEntry(M.lights, ro),
      lightFunctionLayoutEntry(M.lightFunction),
      ...cloudShadowLayoutEntries(SHADOW_MASK_CLOUD_SHADOW, COMPUTE),
      computeBufferEntry(M.factors, ro),
      computeBufferEntry(M.traces, 'storage'),
    ]),
    shadowArgs: shadowArgsKernel(device),
    shadowTrace: createKernel(
      device,
      'shadow trace',
      programs.trace,
      [SHADOW_TRACE_ENTRY],
      [
        computeBufferEntry(T.tables, ro),
        computeBufferEntry(T.traces, ro),
        ...depthAndNormal(T.depth, T.normal),
        computeBufferEntry(T.masks, 'storage'),
        computeBufferEntry(T.lights, ro),
        computeBufferEntry(T.lightTiles, ro),
        ...dagReadLayoutEntries(),
      ],
      { layouts: [sceneTraceLayoutEntries(SHADOW_TRACE_SCENE.first)] },
    ),
  }
}

const tracedShadowKernelsOf = {
  grey: oncePerDevice((device: GPUDevice) => shadowKernels(device, 'grey')),
  colour: oncePerDevice((device: GPUDevice) => shadowKernels(device, 'colour')),
}

/**
 * The traced shadows' programs, made once for the device and the format of the masks when a scene has acceleration structures
 * and its shadows are traced: the masks, the arguments of the trace's dispatch, and the trace, whose second group is the
 * scene trace's (`sceneTraceLayoutEntries`), its first the cut's tables beside its own.
 */
export const tracedShadowKernels = (device: GPUDevice, format: AtlasFormat) =>
  tracedShadowKernelsOf[format](device)

/** The radiosity's program that casts its rays through the scene's triangles, made once for the device when a scene has
 *  acceleration structures and its radiosity is traced, laid out as the traced shadows' trace is. */
export const tracedRadiosityKernels = oncePerDevice((device: GPUDevice) => {
  const R = RADIOSITY_TRACED_BINDINGS
  return {
    radiosityTraced: createKernel(
      device,
      'radiosity trace through triangles',
      RADIOSITY_TRACED_WGSL,
      [RADIOSITY_TRACE_ENTRY],
      [
        ...cardLayoutEntries(R.tables, RADIOSITY_TRACED_UNREAD),
        computeBufferEntry(R.context, ro),
        writes(R.out, 'r32uint'),
        computeBufferEntry(R.lights, ro),
        ...skyLightReadLayoutEntries(R.sky, COMPUTE),
        computeBufferEntry(R.instances, ro),
        noise(R.noise),
        writes(R.hits, 'r32float'),
        ...dagReadLayoutEntries(),
      ],
      { layouts: [sceneTraceLayoutEntries(RADIOSITY_TRACED_SCENE.first)] },
    ),
  }
})

/** What the cull and the combine are made for. */
export interface ShapedKernels {
  readonly maxLights: number
  readonly compressed: boolean
  readonly cull: Kernel<typeof CULL_ENTRY>
  readonly combine: Kernel<(typeof COMBINE_ENTRIES)[number]>
}

/** The cull for tiles that keep `maxLights` lights and the combine of an atlas `compressed` or not. */
export function shapedKernels(
  device: GPUDevice,
  maxLights: number,
  compressed: boolean,
): ShapedKernels {
  const C = COMBINE_BINDINGS
  const K = CULL_BINDINGS
  return {
    maxLights,
    compressed,
    cull: createKernel(
      device,
      `cull ${maxLights}`,
      cullWgsl(maxLights),
      [CULL_ENTRY],
      [
        computeBufferEntry(K.tables, ro),
        computeBufferEntry(K.context, ro),
        computeBufferEntry(K.counts, 'storage'),
        computeBufferEntry(K.cardTileOffsets, 'storage'),
        computeBufferEntry(K.culled, 'storage'),
        computeBufferEntry(K.lights, ro),
        computeBufferEntry(K.depthRanges, ro),
        computeBufferEntry(K.standalone, ro),
      ],
    ),
    combine: createKernel(
      device,
      `combine ${compressed ? 'compressed' : 'plain'}`,
      combineWgsl(compressed),
      COMBINE_ENTRIES,
      [
        computeBufferEntry(C.tables, ro),
        computeBufferEntry(C.context, ro),
        sampled(C.albedo),
        sampled(C.emissive, compressed ? 'float' : 'uint'),
        sampled(C.direct, 'uint'),
        sampled(C.indirect, 'uint'),
        writes(C.out, 'r32uint'),
      ],
    ),
  }
}
