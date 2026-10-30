import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { hasFloat32Filterable } from '../../../gpu/core/float32Filterable.ts'
import { lightAtlasSampleType, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import { skyLightReadLayoutEntries } from '../../../modules/sky/skyLight/read.ts'
import { cloudShadowLayoutEntries } from '../../atmosphere/cloudShadowRead.ts'
import { globalReadLayoutEntries } from '../../distanceField/view.ts'
import { lightFunctionLayoutEntry } from '../../lightFunction/bindings.ts'
import {
  oncePerDeviceOverPrograms,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskedLayoutEntries } from '../../rays/sceneTrace/sceneMaskWgsl.ts'
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
import { DIRECT_BINDINGS, DIRECT_ENTRY, directProgramOf } from './directWgsl.ts'
import {
  FIELD_SHADOW_ENTRIES,
  FIELD_SHADOW_FIRST,
  FIELD_SHADOW_MESH_ENTRY,
  fieldShadowMeshProgramOf,
  fieldShadowProgramOf,
} from './fieldShadowWgsl.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import { lightProfileLayoutEntries } from '../../lightProfile/profileBindings.ts'
import { meshShadowLayoutEntries } from './meshShadowWgsl.ts'
import {
  STOCHASTIC_COMPACT_BINDINGS,
  STOCHASTIC_COMPACT_ENTRY,
  STOCHASTIC_FRAMES_FORMAT,
  STOCHASTIC_GENERATE_BINDINGS,
  STOCHASTIC_GENERATE_ENTRY,
  STOCHASTIC_GENERATE_LIGHT_PROFILE,
  STOCHASTIC_GENERATE_WGSL,
  STOCHASTIC_RESOLVED_FORMAT,
  STOCHASTIC_SHADE_BINDINGS,
  STOCHASTIC_SHADE_ENTRY,
  STOCHASTIC_TEMPORAL_BINDINGS,
  STOCHASTIC_TEMPORAL_ENTRY,
  stochasticCompactProgramOf,
  stochasticShadeProgramOf,
  stochasticTemporalProgramOf,
} from './stochasticWgsl.ts'
import { createKernel, type Kernel } from '../kernel.ts'
import {
  RADIOSITY_BUILD_BINDINGS,
  RADIOSITY_BUILD_ENTRIES,
  RADIOSITY_BUILD_WGSL,
} from './radiosityBuildWgsl.ts'
import {
  RADIOSITY_FILTER_BINDINGS,
  RADIOSITY_FILTER_ENTRIES,
  radiosityFilterProgramOf,
} from './radiosityFilterWgsl.ts'
import {
  RADIOSITY_INTEGRATE_BINDINGS,
  RADIOSITY_INTEGRATE_ENTRY,
  radiosityIntegrateProgramOf,
} from './radiosityIntegrateWgsl.ts'
import {
  TILE_DEPTH_RANGE_BINDINGS,
  TILE_DEPTH_RANGE_ENTRY,
  TILE_DEPTH_RANGE_WGSL,
} from './tileDepthRangeWgsl.ts'
import {
  SHADOW_MASK_BINDINGS,
  SHADOW_MASK_CLOUD_SHADOW,
  SHADOW_MASK_LIGHT_PROFILE,
  SHADOW_MASK_ENTRIES,
  shadowMaskProgramOf,
} from './shadowMaskWgsl.ts'
import {
  SHADOW_ARGS_BINDINGS,
  SHADOW_ARGS_ENTRY,
  SHADOW_ARGS_WGSL,
  SHADOW_TRACE_BINDINGS,
  SHADOW_TRACE_ENTRY,
  SHADOW_TRACE_SCENE,
  shadowTraceProgram,
} from './shadowTraceWgsl.ts'
import {
  RADIOSITY_TRACE_BINDINGS,
  RADIOSITY_TRACE_ENTRY,
  RADIOSITY_TRACE_UNREAD,
  radiosityTraceProgramOf,
  RADIOSITY_TRACED_BINDINGS,
  RADIOSITY_TRACED_SCENE,
  RADIOSITY_TRACED_UNREAD,
  radiosityTracedProgramOf,
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
 * or write the shadow masks are made for the format of the masks, the light functions' atlas's (`fixedKernels`, `tracedShadowKernels`), and
 * those that read or write the atlas's light for the format it is stored in (`light`, `lightAtlasFormat`): one set of programs a device and a format.
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
function contextKernel(device: GPUDevice, constants: GroupWidthConstants) {
  return createKernel(
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
  )
}

function spliceKernel(device: GPUDevice) {
  return createKernel(device, 'splice', SPLICE_WGSL, SPLICE_ENTRIES, [
    computeBufferEntry(1, ro),
    computeBufferEntry(SPLICE_CONTEXT_BINDING, 'storage'),
  ])
}

function lightTileCountsKernel(device: GPUDevice, constants: GroupWidthConstants) {
  return createKernel(
    device,
    'light tile counts',
    LIGHT_TILE_COUNTS_WGSL,
    LIGHT_TILE_COUNTS_ENTRIES,
    [
      computeBufferEntry(LIGHT_TILE_COUNTS_BINDINGS.counts, 'storage'),
      computeBufferEntry(LIGHT_TILE_COUNTS_BINDINGS.args, 'storage'),
    ],
    { constants },
  )
}

function lightTileCompactKernel(device: GPUDevice) {
  return createKernel(
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
  )
}

function tileDepthRangesKernel(device: GPUDevice) {
  const T = TILE_DEPTH_RANGE_BINDINGS
  return createKernel(
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
  )
}

type GroupWidthConstants = ReturnType<typeof groupWidthConstants>

/** The update context's programs. */
function contextKernels(device: GPUDevice, constants: GroupWidthConstants) {
  return {
    context: contextKernel(device, constants),
    splice: spliceKernel(device),
    lightTileCounts: lightTileCountsKernel(device, constants),
    lightTileCompact: lightTileCompactKernel(device),
    tileDepthRanges: tileDepthRangesKernel(device),
  }
}

/** The layout entries of the cards' tables at `tables` and the atlas's layers a program reads, those in `unread` left out, the light stored in `light`. */
const cardLayoutEntries = (tables: number, unread: readonly number[], light: LightAtlasFormat) =>
  surfaceCacheReadLayoutEntries(tables, { feedback: false, compressed: false, light }).filter(
    ({ binding }) => !unread.includes(binding),
  )

/** The radiosity's program that builds the rays. */
function radiosityBuildKernel(
  device: GPUDevice,
  constants: ReturnType<typeof groupWidthConstants>,
) {
  const R = RADIOSITY_BUILD_BINDINGS
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
  }
}

/** The radiosity's program that traces the rays, its radiance stored in `light`. */
function radiosityTraceKernel(device: GPUDevice, light: LightAtlasFormat) {
  const T = RADIOSITY_TRACE_BINDINGS
  const filterableMip = hasFloat32Filterable(device.features)
  return {
    radiosityTrace: createKernel(
      device,
      'radiosity trace',
      radiosityTraceProgramOf(light, filterableMip),
      [RADIOSITY_TRACE_ENTRY],
      [
        ...cardLayoutEntries(T.tables, RADIOSITY_TRACE_UNREAD, light),
        computeBufferEntry(T.context, ro),
        writes(T.out, light),
        computeBufferEntry(T.lights, ro),
        ...skyLightReadLayoutEntries(T.sky, COMPUTE),
        ...globalReadLayoutEntries(T.field, filterableMip),
        computeBufferEntry(T.grid, ro),
        computeBufferEntry(T.instances, ro),
        noise(T.noise),
      ],
    ),
  }
}

/** The radiosity's programs that filter the rays and integrate them, the light stored in `light`. */
function radiosityShadeKernels(device: GPUDevice, light: LightAtlasFormat) {
  const F = RADIOSITY_FILTER_BINDINGS
  const I = RADIOSITY_INTEGRATE_BINDINGS
  return {
    radiosityFilter: createKernel(
      device,
      'radiosity filter',
      radiosityFilterProgramOf(light),
      RADIOSITY_FILTER_ENTRIES,
      [
        computeBufferEntry(F.tables, ro),
        computeBufferEntry(F.context, ro),
        ...depthAndNormal(F.depth, F.normal),
        noise(F.noise),
        sampled(F.trace, lightAtlasSampleType(light)),
        computeBufferEntry(F.filtered, 'storage'),
        computeStorageTextureEntry(F.harmonics, 'rgba16float', 'write-only', '2d-array'),
        sampled(F.hits, 'unfilterable-float'),
      ],
    ),
    radiosityIntegrate: createKernel(
      device,
      'radiosity integrate',
      radiosityIntegrateProgramOf(light),
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

/** The programs that depend on neither the shape nor the light's format, made once for the device. */
const unshapedKernels = oncePerDevice((device: GPUDevice) => {
  const constants = groupWidthConstants(groupWidth(device.limits))
  return { ...contextKernels(device, constants), ...radiosityBuildKernel(device, constants) }
})

/** The programs that do not depend on the shape, made once for the device and the format the atlas's light is stored in. */
const staticKernels = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) => ({
  ...unshapedKernels(device),
  ...radiosityTraceKernel(device, light),
  ...radiosityShadeKernels(device, light),
}))

/** The direct light's program over masks in `format`, made once for the device and the format of the light. */
const directKernelOf = {
  grey: oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) =>
    directKernel(device, 'grey', light),
  ),
  colour: oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) =>
    directKernel(device, 'colour', light),
  ),
}

function directKernel(device: GPUDevice, format: AtlasFormat, light: LightAtlasFormat) {
  const D = DIRECT_BINDINGS
  return createKernel(
    device,
    'direct light',
    directProgramOf(format, light),
    [DIRECT_ENTRY],
    [
      computeBufferEntry(D.tables, ro),
      computeBufferEntry(D.context, ro),
      ...depthAndNormal(D.depth, D.normal),
      computeBufferEntry(D.cardTileLights, ro),
      writes(D.out, light),
      computeBufferEntry(D.lights, ro),
      computeBufferEntry(D.masks, ro),
      computeBufferEntry(D.factors, 'storage'),
      computeBufferEntry(D.cardTileOffsets, ro),
    ],
  )
}

/** The programs of an image whose light functions' atlas has the format `format` and whose light is stored in `light`: those that do not depend on the shape
 *  (`staticKernels`) and the direct light's, which reads the masks in that format. */
export const fixedKernels = (device: GPUDevice, format: AtlasFormat, light: LightAtlasFormat) => ({
  ...staticKernels(device, light),
  direct: directKernelOf[format](device, light),
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

/** The masks' program over masks in `format`, and the arguments of the traces' dispatch it lists: what every shadow pass starts with, made once for the device and the format. */
const maskKernelsOf = {
  grey: oncePerDevice((device: GPUDevice) => makeMaskKernels(device, 'grey')),
  colour: oncePerDevice((device: GPUDevice) => makeMaskKernels(device, 'colour')),
}
const maskKernels = (device: GPUDevice, format: AtlasFormat) => maskKernelsOf[format](device)

/** The bindings of the mask's program, whatever light it makes the masks of: the light tiles' tables, counters, layers and masks, the light functions, the clouds' shade, the factors, the traces and the light profiles. */
export function shadowMaskLayoutEntries() {
  const M = SHADOW_MASK_BINDINGS
  return [
    ...fieldTileEntries(),
    lightFunctionLayoutEntry(M.lightFunction),
    ...cloudShadowLayoutEntries(SHADOW_MASK_CLOUD_SHADOW, COMPUTE),
    computeBufferEntry(M.factors, ro),
    computeBufferEntry(M.traces, 'storage'),
    ...lightProfileLayoutEntries(SHADOW_MASK_LIGHT_PROFILE, COMPUTE),
  ]
}

function makeMaskKernels(device: GPUDevice, format: AtlasFormat) {
  return {
    shadowMask: createKernel(
      device,
      'shadow masks',
      shadowMaskProgramOf(format),
      SHADOW_MASK_ENTRIES,
      shadowMaskLayoutEntries(),
    ),
    shadowArgs: shadowArgsKernel(device),
  }
}

/** The bindings of a pass that answers the listed traces over the masks: the tables, the traces, the depth and normal layers, the masks, the lights and the light tiles. */
function traceAnswerEntries() {
  const T = SHADOW_TRACE_BINDINGS
  return [
    computeBufferEntry(T.tables, ro),
    computeBufferEntry(T.traces, ro),
    ...depthAndNormal(T.depth, T.normal),
    computeBufferEntry(T.masks, 'storage'),
    computeBufferEntry(T.lights, ro),
    computeBufferEntry(T.lightTiles, ro),
  ]
}

function shadowKernels(device: GPUDevice, format: AtlasFormat, programs: SceneMaskPrograms) {
  return {
    ...maskKernels(device, format),
    shadowTrace: createKernel(
      device,
      `shadow trace ${format}|${sceneMaskKey(programs)}`,
      shadowTraceProgram(format, programs),
      [SHADOW_TRACE_ENTRY],
      [...traceAnswerEntries(), ...dagReadLayoutEntries()],
      { layouts: [sceneMaskedLayoutEntries(SHADOW_TRACE_SCENE.first)] },
    ),
  }
}

/**
 * The traced shadows' programs, made once for the device, the format of the masks and the set of graph masks the rays cut by, when a scene has acceleration structures
 * and its shadows are traced: the masks, the arguments of the trace's dispatch, and the trace, whose second group is the
 * scene trace's (`sceneMaskedLayoutEntries`), its first the cut's tables beside its own.
 */
export const tracedShadowKernels = oncePerDeviceOverPrograms(
  (device: GPUDevice, format: AtlasFormat, programs) => shadowKernels(device, format, programs),
)

/** The bindings of a pass over the light tiles that settles their masks: the tables, the light tiles' counters, the depth and normal layers, the light tiles, the masks and the lights. */
function fieldTileEntries() {
  const M = SHADOW_MASK_BINDINGS
  return [
    computeBufferEntry(M.tables, ro),
    computeBufferEntry(M.counts, ro),
    ...depthAndNormal(M.depth, M.normal),
    computeBufferEntry(M.lightTiles, ro),
    computeBufferEntry(M.masks, 'storage'),
    computeBufferEntry(M.lights, ro),
  ]
}

function fieldKernels(device: GPUDevice, format: AtlasFormat) {
  const filterableMip = hasFloat32Filterable(device.features)
  return {
    shadowMask: maskKernels(device, format).shadowMask,
    fieldShadow: createKernel(
      device,
      'shadow through the global field',
      fieldShadowProgramOf(format, filterableMip),
      FIELD_SHADOW_ENTRIES,
      [...fieldTileEntries(), ...globalReadLayoutEntries(FIELD_SHADOW_FIRST, filterableMip)],
    ),
  }
}

const fieldShadowKernelsOf = {
  grey: oncePerDevice((device: GPUDevice) => fieldKernels(device, 'grey')),
  colour: oncePerDevice((device: GPUDevice) => fieldKernels(device, 'colour')),
}

/**
 * The shadow passes of an image whose shadows are not traced through the scene's triangles, made once for the device and the format of
 * the masks: the masks and the pass that settles them through the global distance field, over the same light tiles.
 */
export const fieldShadowKernels = (device: GPUDevice, format: AtlasFormat) =>
  fieldShadowKernelsOf[format](device)

const fieldShadowMeshKernelOf = {
  grey: oncePerDevice((device: GPUDevice) => fieldMeshKernel(device, 'grey')),
  colour: oncePerDevice((device: GPUDevice) => fieldMeshKernel(device, 'colour')),
}

function fieldMeshKernel(device: GPUDevice, format: AtlasFormat) {
  return createKernel(
    device,
    'shadow through the suns meshes',
    fieldShadowMeshProgramOf(format),
    [FIELD_SHADOW_MESH_ENTRY],
    fieldTileEntries(),
    { layouts: [meshShadowLayoutEntries()] },
  )
}

/** The pass that settles the masks of the suns whose meshes' fields are listed, through those, made on the first image that has the lists, once for the device and the format of the masks, and waited for (an image without it shadows the suns through the global field). */
export const fieldShadowMeshKernel = (device: GPUDevice, format: AtlasFormat) =>
  fieldShadowMeshKernelOf[format](device)

/** The radiosity's program that casts its rays through the scene's triangles, made once for the device and the format of the light when a scene has
 *  acceleration structures and its radiosity is traced, laid out as the traced shadows' trace is. */
export const tracedRadiosityKernels = oncePerDeviceOverPrograms(
  (device: GPUDevice, light: LightAtlasFormat, programs) => {
    const R = RADIOSITY_TRACED_BINDINGS
    return {
      radiosityTraced: createKernel(
        device,
        `radiosity trace through triangles ${light}|${sceneMaskKey(programs)}`,
        radiosityTracedProgramOf(light, programs),
        [RADIOSITY_TRACE_ENTRY],
        [
          ...cardLayoutEntries(R.tables, RADIOSITY_TRACED_UNREAD, light),
          computeBufferEntry(R.context, ro),
          writes(R.out, light),
          computeBufferEntry(R.lights, ro),
          ...skyLightReadLayoutEntries(R.sky, COMPUTE),
          computeBufferEntry(R.instances, ro),
          noise(R.noise),
          writes(R.hits, 'r32float'),
          ...dagReadLayoutEntries(),
        ],
        { layouts: [sceneMaskedLayoutEntries(RADIOSITY_TRACED_SCENE.first)] },
      ),
    }
  },
)

/** What the cull and the combine are made for. */
export interface ShapedKernels {
  readonly maxLights: number
  readonly compressed: boolean
  readonly light: LightAtlasFormat
  readonly cull: Kernel<typeof CULL_ENTRY>
  readonly combine: Kernel<(typeof COMBINE_ENTRIES)[number]>
}

/** The cull for tiles that keep `maxLights` lights and the combine of an atlas `compressed` or not, its light stored in `light`. */
export function shapedKernels(
  device: GPUDevice,
  maxLights: number,
  compressed: boolean,
  light: LightAtlasFormat,
): ShapedKernels {
  const C = COMBINE_BINDINGS
  const K = CULL_BINDINGS
  return {
    maxLights,
    compressed,
    light,
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
      combineWgsl(compressed, light),
      COMBINE_ENTRIES,
      [
        computeBufferEntry(C.tables, ro),
        computeBufferEntry(C.context, ro),
        sampled(C.albedo),
        sampled(C.emissive, compressed ? 'float' : 'uint'),
        sampled(C.direct, lightAtlasSampleType(light)),
        sampled(C.indirect, 'uint'),
        writes(C.out, light),
      ],
    ),
  }
}

const unfilterable = (binding: number) => sampled(binding, 'unfilterable-float')

/** The generation of the samples: it picks the lights of the tiles itself, so it writes the light tiles the cull writes. */
const stochasticGenerateKernel = oncePerDevice((device: GPUDevice) => {
  const G = STOCHASTIC_GENERATE_BINDINGS
  return createKernel(
    device,
    'stochastic direct light samples',
    STOCHASTIC_GENERATE_WGSL,
    [STOCHASTIC_GENERATE_ENTRY],
    [
      computeBufferEntry(G.tables, ro),
      computeBufferEntry(G.context, ro),
      computeBufferEntry(G.counts, 'storage'),
      ...depthAndNormal(G.depth, G.normal),
      computeBufferEntry(G.culled, 'storage'),
      computeBufferEntry(G.cardTileOffsets, 'storage'),
      computeBufferEntry(G.lights, ro),
      computeBufferEntry(G.standalone, ro),
      computeBufferEntry(G.samples, 'storage'),
      lightFunctionLayoutEntry(G.lightFunction),
      ...lightProfileLayoutEntries(STOCHASTIC_GENERATE_LIGHT_PROFILE, COMPUTE),
      noise(G.noise),
    ],
  )
})

function stochasticCompactKernel(device: GPUDevice, format: AtlasFormat) {
  const C = STOCHASTIC_COMPACT_BINDINGS
  return createKernel(
    device,
    'stochastic direct light trace compaction',
    stochasticCompactProgramOf(format),
    [STOCHASTIC_COMPACT_ENTRY],
    [
      computeBufferEntry(C.tables, ro),
      computeBufferEntry(C.context, ro),
      computeBufferEntry(C.cardTileLights, ro),
      computeBufferEntry(C.cardTileOffsets, ro),
      computeBufferEntry(C.samples, ro),
      computeBufferEntry(C.masks, ro),
      computeBufferEntry(C.traces, 'storage'),
      ...depthAndNormal(C.depth, C.normal),
    ],
  )
}

function stochasticShadeKernel(device: GPUDevice, format: AtlasFormat, light: LightAtlasFormat) {
  const S = STOCHASTIC_SHADE_BINDINGS
  return createKernel(
    device,
    'stochastic direct light shading',
    stochasticShadeProgramOf(format, light),
    [STOCHASTIC_SHADE_ENTRY],
    [
      computeBufferEntry(S.tables, ro),
      computeBufferEntry(S.context, ro),
      ...depthAndNormal(S.depth, S.normal),
      computeBufferEntry(S.cardTileLights, ro),
      computeBufferEntry(S.cardTileOffsets, ro),
      computeBufferEntry(S.samples, ro),
      computeBufferEntry(S.masks, ro),
      writes(S.out, light),
      writes(S.resolved, STOCHASTIC_RESOLVED_FORMAT),
    ],
  )
}

function stochasticTemporalKernel(device: GPUDevice, light: LightAtlasFormat) {
  const T = STOCHASTIC_TEMPORAL_BINDINGS
  return createKernel(
    device,
    'stochastic direct light temporal blend',
    stochasticTemporalProgramOf(light),
    [STOCHASTIC_TEMPORAL_ENTRY],
    [
      computeBufferEntry(T.tables, ro),
      computeBufferEntry(T.context, ro),
      ...depthAndNormal(T.depth, T.normal),
      computeBufferEntry(T.samples, ro),
      unfilterable(T.resolved),
      unfilterable(T.historyLighting),
      unfilterable(T.historyFrames),
      writes(T.lightingOut, STOCHASTIC_RESOLVED_FORMAT),
      writes(T.framesOut, STOCHASTIC_FRAMES_FORMAT),
      writes(T.out, light),
    ],
  )
}

function stochasticKernelsFor(device: GPUDevice, format: AtlasFormat, light: LightAtlasFormat) {
  return {
    compact: stochasticCompactKernel(device, format),
    shade: stochasticShadeKernel(device, format, light),
    temporal: stochasticTemporalKernel(device, light),
  }
}

const stochasticKernelsOf = {
  grey: oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) =>
    stochasticKernelsFor(device, 'grey', light),
  ),
  colour: oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) =>
    stochasticKernelsFor(device, 'colour', light),
  ),
}

/** The stochastic direct light's programs (`stochasticWgsl.ts`), made once for the device, the format of the masks and the format of the light, when the direct light's shadows are traced and it is asked for. */
export const stochasticKernels = (
  device: GPUDevice,
  format: AtlasFormat,
  light: LightAtlasFormat,
) => ({
  ...stochasticKernelsOf[format](device, light),
  generate: stochasticGenerateKernel(device),
})
