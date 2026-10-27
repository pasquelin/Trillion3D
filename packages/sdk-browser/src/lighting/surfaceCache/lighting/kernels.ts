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
  CONTEXT_TRACES_BINDING,
  CONTEXT_WGSL,
} from './contextWgsl.ts'
import { CULL_ENTRY, cullWgsl } from './cullWgsl.ts'
import { DIRECT_BINDINGS, DIRECT_CLOUD_SHADOW, DIRECT_ENTRIES, DIRECT_WGSL } from './directWgsl.ts'
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
  SHADOW_MASK_BINDINGS,
  SHADOW_MASK_CLOUD_SHADOW,
  SHADOW_MASK_ENTRY,
  SHADOW_MASK_PROGRAM_WGSL,
} from './shadowMaskWgsl.ts'
import {
  SHADOW_ARGS_BINDINGS,
  SHADOW_ARGS_ENTRY,
  SHADOW_ARGS_WGSL,
  SHADOW_TRACE_BINDINGS,
  SHADOW_TRACE_ENTRY,
  SHADOW_TRACE_SCENE,
  SHADOW_TRACE_WGSL,
} from './shadowTraceWgsl.ts'
import {
  RADIOSITY_TRACE_BINDINGS,
  RADIOSITY_TRACE_ENTRY,
  RADIOSITY_TRACE_UNREAD,
  RADIOSITY_TRACE_WGSL,
} from './radiosityTraceWgsl.ts'

/**
 * THE LIGHTING'S KERNELS ON THE GPU: the pipeline and the bind group layout of each program (`contextWgsl.ts`,
 * `cullWgsl.ts`, `directWgsl.ts`, `combineWgsl.ts`, `radiosityBuildWgsl.ts`, `radiosityTraceWgsl.ts`,
 * `radiosityFilterWgsl.ts`, `radiosityIntegrateWgsl.ts`, and the traced shadows' `shadowMaskWgsl.ts` and
 * `shadowTraceWgsl.ts`), compiled off the frame, and the bind group of an image, made again
 * only when a resource it names moved. The programs that do not depend on the shape are made once for a device
 * (`staticKernels`), those of the traced shadows once a scene has acceleration structures (`tracedKernels`); the cull is
 * made for the lights a tile keeps and the combine for the atlas's kind of emission layer (`shapedKernels`).
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

/** The context's and the direct light's programs. */
function contextKernels(device: GPUDevice, constants: ReturnType<typeof groupWidthConstants>) {
  const D = DIRECT_BINDINGS
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
      ],
      { constants },
    ),
    direct: createKernel(device, 'direct light', DIRECT_WGSL, DIRECT_ENTRIES, [
      computeBufferEntry(D.tables, ro),
      computeBufferEntry(D.context, ro),
      ...depthAndNormal(D.depth, D.normal),
      computeBufferEntry(D.tileLights, ro),
      writes(D.out, 'r32uint'),
      computeBufferEntry(D.lights, ro),
      lightFunctionLayoutEntry(D.lightFunction),
      ...cloudShadowLayoutEntries(DIRECT_CLOUD_SHADOW, COMPUTE),
      ...globalReadLayoutEntries(D.field),
      computeBufferEntry(D.masks, ro),
      computeBufferEntry(D.factors, 'storage'),
    ]),
  }
}

/** The radiosity's programs that build the rays and trace them. */
function radiosityTraceKernels(
  device: GPUDevice,
  constants: ReturnType<typeof groupWidthConstants>,
) {
  const read = surfaceCacheReadLayoutEntries(RADIOSITY_TRACE_BINDINGS.tables, {
    feedback: false,
    compressed: false,
  }).filter(({ binding }) => !RADIOSITY_TRACE_UNREAD.includes(binding))
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
        noise(R.noise),
      ],
      { constants },
    ),
    radiosityTrace: createKernel(
      device,
      'radiosity trace',
      RADIOSITY_TRACE_WGSL,
      [RADIOSITY_TRACE_ENTRY],
      [
        ...read,
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
        noise(I.noise),
        computeTextureEntry(I.harmonics, 'float', '2d-array'),
        readWrites(I.indirect, 'r32uint'),
        readWrites(I.frames, 'r32uint'),
      ],
    ),
  }
}

/** The programs that do not depend on the shape, made once for the device. */
export const staticKernels = oncePerDevice((device: GPUDevice) => {
  const constants = groupWidthConstants(groupWidth(device.limits))
  return {
    ...contextKernels(device, constants),
    ...radiosityTraceKernels(device, constants),
    ...radiosityShadeKernels(device),
  }
})

/**
 * The programs of the traced shadows, made once for the device when a scene has acceleration structures: the masks, the
 * arguments of the trace's dispatch, and the trace, whose second group is the scene trace's (`sceneTraceLayoutEntries`),
 * its first the cut's tables beside its own.
 */
export const tracedKernels = oncePerDevice((device: GPUDevice) => {
  const constants = groupWidthConstants(groupWidth(device.limits))
  const M = SHADOW_MASK_BINDINGS
  const A = SHADOW_ARGS_BINDINGS
  const T = SHADOW_TRACE_BINDINGS
  return {
    shadowMask: createKernel(
      device,
      'shadow masks',
      SHADOW_MASK_PROGRAM_WGSL,
      [SHADOW_MASK_ENTRY],
      [
        computeBufferEntry(M.tables, ro),
        computeBufferEntry(M.context, ro),
        ...depthAndNormal(M.depth, M.normal),
        computeBufferEntry(M.tileLights, ro),
        computeBufferEntry(M.masks, 'storage'),
        computeBufferEntry(M.lights, ro),
        lightFunctionLayoutEntry(M.lightFunction),
        ...cloudShadowLayoutEntries(SHADOW_MASK_CLOUD_SHADOW, COMPUTE),
        computeBufferEntry(M.factors, ro),
        computeBufferEntry(M.traces, 'storage'),
        computeBufferEntry(M.lightTiles, 'storage'),
      ],
    ),
    shadowArgs: createKernel(
      device,
      'shadow trace arguments',
      SHADOW_ARGS_WGSL,
      [SHADOW_ARGS_ENTRY],
      [
        computeBufferEntry(A.tables, ro),
        computeBufferEntry(A.context, 'storage'),
        computeBufferEntry(A.traces, ro),
      ],
      { constants },
    ),
    shadowTrace: createKernel(
      device,
      'shadow trace',
      SHADOW_TRACE_WGSL,
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
  return {
    maxLights,
    compressed,
    cull: createKernel(
      device,
      `cull ${maxLights}`,
      cullWgsl(maxLights),
      [CULL_ENTRY],
      [
        computeBufferEntry(1, ro),
        computeBufferEntry(2, ro),
        ...depthAndNormal(3, 4),
        computeBufferEntry(5, 'storage'),
        computeBufferEntry(6, ro),
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
