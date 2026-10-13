import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { validated } from '../gpu/core/errorScope.ts'
import { shaderFailed } from '../gpu/core/shaderModule.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../lighting/deferred/fullscreen.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'
import type { GpuHiz, HizDepth } from '../gpu/hiz/types.ts'
import { hizDepthBindEntries, hizDepthEntries } from '../gpu/hiz/pyramidTexture.ts'
import { REFLECTION_FORMAT } from './constants.ts'
import { FRONT_SHADER, createFrontDepth, frontBytes, frontLayout } from './frontDepth.ts'
import {
  RADIANCE_SHADER,
  createRadiancePyramid,
  radianceBytes,
  radianceLayouts,
} from './radiance.ts'
import { SETTLE_BYTES, createRadianceSettle } from './settle.ts'
import { createProxyStore } from './proxyStore.ts'
import { storeBytes } from '../bounce/runtimeLayout.ts'
import {
  BEGIN_SHADER,
  TRACE_SHADER,
  createTraceStages,
  createTraceTiles,
  TRACE_ARGS_BYTES,
  traceListBytes,
  createTraceGroups,
} from './trace.ts'
import { createReflectionViewWriter } from './viewWrite.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_GROUP,
  REFLECTION_IMAGE_BINDING,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_VIEW_BYTES,
} from './viewLayout.ts'
import { REFLECTION_TARGET } from './weight.ts'

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, the
 *  radiance pyramid's levels from 1 on and its sampler, then the depth pyramid
 *  (`hizDepthEntries`), the lighting's view and the pyramid's level 0, the lit image itself, read by
 *  compute and fragment stages. */
export const reflectionLayout = oncePerDevice((device: GPUDevice) => {
  const visibility = COMPUTE | GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0, { minBindingSize: REFLECTION_VIEW_BYTES }, visibility),
      computeTextureEntry(1, 'float', '2d', visibility),
      { binding: 2, visibility, sampler: { type: 'filtering' } },
      ...hizDepthEntries(REFLECTION_DEPTH_BINDING, visibility),
      computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform', visibility),
      computeTextureEntry(REFLECTION_IMAGE_BINDING, 'float', '2d', visibility),
    ],
  })
})

/** The reflection's kernels — the frame state, the opaque trace and its tile classification, the
 *  radiance pyramid's two, the front depth's scatter — compiled once a device under one validation scope. */
export const createReflectionPipelines = oncePerDevice((device: GPUDevice) =>
  validated(device, async () => {
    const modules = {
      trace: device.createShaderModule({
        label: 'Trillion3D reflection trace',
        code: TRACE_SHADER,
      }),
      begin: device.createShaderModule({
        label: 'Trillion3D reflection begin',
        code: BEGIN_SHADER,
      }),
      radiance: device.createShaderModule({
        label: 'Trillion3D reflection radiance',
        code: RADIANCE_SHADER,
      }),
      front: device.createShaderModule({
        label: 'Trillion3D reflection front depth',
        code: FRONT_SHADER,
      }),
    }
    for (const made of Object.values(modules)) if (await shaderFailed(made)) return undefined
    const layouts = radianceLayouts(device)
    const frontLayouts = frontLayout(device)
    const [trace, first, down, roll, front] = await Promise.all([
      createTraceStages(device, modules, reflectionLayout(device)),
      buildComputeStages(device, [layouts.firstLayout], modules.radiance, [
        'radianceFirst',
        'radianceFirstHashed',
        'radianceFirstBoth',
      ]),
      buildComputeStages(device, [layouts.downLayout], modules.radiance, ['radianceDown']),
      buildComputeStages(device, [layouts.rollLayout], modules.radiance, ['radianceRoll']),
      buildComputeStages(device, [frontLayouts], modules.front, ['frontScatter']),
    ])
    return {
      ...trace,
      ...layouts,
      firstPipeline: first.radianceFirst,
      firstHashedPipeline: first.radianceFirstHashed,
      firstBothPipeline: first.radianceFirstBoth,
      downPipeline: down.radianceDown,
      rollPipeline: roll.radianceRoll,
      frontLayout: frontLayouts,
      frontPipeline: front.frontScatter,
    }
  }),
)
export type ReflectionPipelines = NonNullable<Awaited<ReturnType<typeof createReflectionPipelines>>>

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  radiance pyramid — the lit image of the HDR targets' turn about, its level 0, then the levels
 *  after it at half the size, the bytes of one pyramid —, its tile list, its uniform, its radiance
 *  hash, the front depth (`frontBytes`, which `blends` sizes) and, while a placement wears a proxy
 *  (`store`), the run-time proxy's answers (`proxyStore.ts`); the depth it marches is the Hi-Z's, its
 *  front depth folded in. */
export function reflectionBytes(width: number, height: number, blends: boolean, store = false) {
  return (
    REFLECTION_TARGET.bytes(width, height, true) +
    radianceBytes(width, height) +
    frontBytes(width, height, blends) +
    traceListBytes(width, height) +
    TRACE_ARGS_BYTES +
    REFLECTION_VIEW_BYTES +
    SETTLE_BYTES +
    // The run-time proxy's answers, while a placement wears a proxy (`proxyStore.ts`).
    (store ? storeBytes(width, height) : 0)
  )
}

/**
 * A view's reflection at `width × height`: the target the opaque trace writes, the radiance
 * pyramid of its last lit image (`radiance`, which holds the image it was made of: the next image
 * reprojects its hits with its view-projection), the tile list of the trace, the view uniform —
 * whose surroundings the GPU writes — and the writer of the rest of it. `blends`, whether the scene
 * has any, sizes the front depth (`createFrontDepth`).
 */
export function createScreenReflection(
  device: GPUDevice,
  width: number,
  height: number,
  blends: boolean,
  store = false,
) {
  // `COPY_SRC` and `COPY_DST` serve only the proof tools, which reread the target and set it first;
  // no frame copies it.
  const target = device.createTexture({
    label: 'Trillion3D reflection',
    size: [width, height],
    format: REFLECTION_FORMAT,
    usage: loadOnlyUsage() | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D reflection view',
    size: REFLECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const radiance = createRadiancePyramid(device, width, height)
  const tiles = createTraceTiles(device, width, height)
  const settle = createRadianceSettle(device)
  const front = createFrontDepth(device, width, height, blends)
  const answers = createProxyStore(device, width, height, store)
  return {
    device,
    target,
    targetView: target.createView(),
    radiance,
    tiles,
    uniform,
    settle,
    /** The run-time proxy's answers, kept from image to image (`proxyStore.ts`). */
    store: answers,
    front,
    writeView: createReflectionViewWriter(device, uniform),
    /** The reflection group over the depth it was bound with (`GpuHiz.depth`), the lit image the
     *  pyramid holds as its level 0 and the lighting's view: two kept, the two HDR targets taking
     *  turns (`reflectionGroup`). */
    group: {
      identity: createWebgpuBindIdentity(2),
      slots: [] as (GPUBindGroup | undefined)[],
    },
    /** The trace's bind groups, kept while its inputs stay (`encodeReflectionTrace`). */
    trace: createTraceGroups(),
    dispose() {
      target.destroy()
      radiance.coarse.destroy()
      radiance.image.texture.destroy()
      tiles.args.destroy()
      tiles.list.destroy()
      uniform.destroy()
      settle.dispose()
      answers.dispose()
      front.dispose()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), the lit
 *  image its pyramid holds now and the lighting's view `lightView`, made again when one of them is
 *  not the one it was made over: the two HDR targets taking turns find a group each. */
export function reflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  lightView: GPUBuffer,
) {
  const image = reflection.radiance.image.view,
    { identity, slots } = reflection.group
  identity.next[0] = depth
  identity.next[1] = image
  identity.next[2] = lightView
  identity.next.length = 3
  const moved = identity.moved()
  const kept = slots[identity.slot]
  if (kept && !moved) return kept
  const { device } = reflection
  return (slots[identity.slot] = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: 0, resource: { buffer: reflection.uniform } },
      { binding: 1, resource: reflection.radiance.view },
      { binding: 2, resource: reflection.radiance.sampler },
      ...hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth),
      { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: lightView } },
      { binding: REFLECTION_IMAGE_BINDING, resource: image },
    ],
  }))
}

/** What a frame holds that the reflection reads (`reflectionLightView`). */
export type ReflectionHost = {
  gpu: {
    reflection?: ScreenReflection
    deferred?: { uniform: GPUBuffer }
  }
  vis: { gpuHiz?: GpuHiz }
}

/** The reflection group's other resource: the lighting's view. Undefined while the lighting is not made. */
export const reflectionLightView = ({ gpu }: ReflectionHost) => gpu.deferred?.uniform

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection
 *  over its depth pyramid, both made with the frame's targets and the visibility programs. */
export function bindForwardReflection(pass: GPURenderPassEncoder, rt: ReflectionHost) {
  const depth = rt.vis.gpuHiz?.depth(),
    lightView = reflectionLightView(rt)
  if (rt.gpu.reflection && depth && lightView)
    pass.setBindGroup(REFLECTION_GROUP, reflectionGroup(rt.gpu.reflection, depth, lightView))
}

/** The image the reflections last reflected shows a scene that is no more: content joined it. The
 *  next image traces nothing and builds the radiance from its own lit image, as a scene opened with
 *  that content draws its first, so the images that follow are the same bits as a fresh open's,
 *  whatever the scene was before — the series they converge to starts from the same image. */
export function forgetReflectedImage(reflection: ScreenReflection | undefined) {
  if (!reflection) return
  reflection.radiance.held.valid = false
  reflection.settle.busy()
}

/**
 * Whether the view's reflections are what a still view shows: the radiance pyramid holds an image
 * of this view, and — when no temporal accumulation turns the projection from image to image, whose
 * own settling covers it — that image was drawn from where the one before it was, and its lit
 * image is the one before it's (`settle.verified`), so the image traced on it reflects the view as
 * it stands, never the one it moved from nor the light it changed. A held image is then final:
 * drawn again, it gives the same bits.
 */
export const reflectionsSettled = (
  reflection: ScreenReflection | undefined,
  accumulating: boolean,
) =>
  !reflection ||
  (reflection.radiance.held.valid &&
    (accumulating || (reflection.radiance.held.still && reflection.settle.verified)))
