import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { validated } from '../gpu/core/errorScope.ts'
import { shaderFailed } from '../gpu/core/shaderModule.ts'
import { COMPUTE, computeBufferEntry } from '../gpu/core/computeBindings.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { buildComputeStages } from '../lighting/deferred/fullscreen.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'
import type { GpuHiz, HizDepth } from '../gpu/hiz/types.ts'
import { hizDepthBindEntries, hizDepthEntries } from '../gpu/hiz/pyramidTexture.ts'
import { REFLECTION_FORMAT } from './constants.ts'
import { HDR_FORMAT } from '../scene/surfaceBuffer.ts'
import {
  FRONT_BOX_SHADER,
  FRONT_SHADER,
  createFrontDepth,
  frontBoxLayout,
  frontBytes,
  frontLayout,
} from './frontDepth.ts'
import {
  RADIANCE_SHADER,
  createRadiancePyramid,
  radianceLayouts,
  radianceLevels,
} from './radiance.ts'
import { RADIANCE_HASH_BYTES, SAMPLE_BYTES, createRadianceSettle } from './settle.ts'
import { createProxyStore } from './proxyStore.ts'
import { storeBytes } from '../bounce/runtimeLayout.ts'
import {
  BEGIN_SHADER,
  TRACE_SHADER,
  createTraceStages,
  createTraceTiles,
  TRACE_ARGS_BYTES,
  traceListBytes,
  type TraceGroups,
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
      {
        binding: 0,
        visibility,
        buffer: { type: 'uniform', minBindingSize: REFLECTION_VIEW_BYTES },
      },
      { binding: 1, visibility, texture: { sampleType: 'float' } },
      { binding: 2, visibility, sampler: { type: 'filtering' } },
      ...hizDepthEntries(REFLECTION_DEPTH_BINDING, visibility),
      computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform', visibility),
      { binding: REFLECTION_IMAGE_BINDING, visibility, texture: { sampleType: 'float' } },
    ],
  })
})

/** The reflection's kernels — the frame state, the opaque trace and its tile classification, the
 *  radiance pyramid's two, the front depth's scatter, boxes and fold — compiled once a device under one validation scope. */
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
      frontBox: device.createShaderModule({
        label: 'Trillion3D reflection front depth boxes',
        code: FRONT_BOX_SHADER,
      }),
    }
    for (const made of Object.values(modules)) if (await shaderFailed(made)) return undefined
    const layouts = radianceLayouts(device)
    const frontLayouts = frontLayout(device),
      frontBoxLayouts = frontBoxLayout(device)
    const [trace, first, down, roll, front, box] = await Promise.all([
      createTraceStages(device, modules, reflectionLayout(device)),
      buildComputeStages(device, [layouts.firstLayout], modules.radiance, [
        'radianceFirst',
        'radianceFirstHashed',
        'radianceFirstBoth',
      ]),
      buildComputeStages(device, [layouts.downLayout], modules.radiance, ['radianceDown']),
      buildComputeStages(device, [layouts.rollLayout], modules.radiance, ['radianceRoll']),
      buildComputeStages(device, [frontLayouts], modules.front, ['frontScatter', 'frontFold']),
      buildComputeStages(device, [frontBoxLayouts], modules.frontBox, ['frontBox']),
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
      frontFoldPipeline: front.frontFold,
      frontBoxLayout: frontBoxLayouts,
      frontBoxPipeline: box.frontBox,
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
    textureBytesOf({ size: [width, height], format: HDR_FORMAT })! +
    textureBytesOf({
      size: [Math.max(1, width >> 1), Math.max(1, height >> 1)],
      format: REFLECTION_FORMAT,
      mipLevelCount: Math.max(1, radianceLevels(width, height) - 1),
    })! +
    frontBytes(width, height, blends) +
    traceListBytes(width, height) +
    TRACE_ARGS_BYTES +
    REFLECTION_VIEW_BYTES +
    RADIANCE_HASH_BYTES +
    SAMPLE_BYTES * 3 +
    // The run-time proxy's answers, while a placement wears a proxy (`proxyStore.ts`).
    (store ? storeBytes(width, height) : 0)
  )
}

/**
 * A view's reflection at `width × height`: the target the opaque trace writes, the radiance
 * pyramid of its last lit image (`radiance`, which holds the image it was made of: the next image
 * reprojects its hits with its view-projection), the tile list of the trace, the view uniform and
 * its writer. `blends`, whether the scene
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
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
    /** The reflection group over each depth it was bound with (`GpuHiz.depth`, a view's) and each
     *  lit image the pyramid held as its level 0 (the two HDR targets take turns), and what else
     *  it was made over. */
    groups: new WeakMap<
      HizDepth,
      WeakMap<GPUTextureView, { group: GPUBindGroup; over: unknown[] }>
    >(),
    /** The trace's bind groups, kept while its inputs stay (`encodeReflectionTrace`). */
    traceGroups: undefined as TraceGroups | undefined,
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

/** What the reflection group holds beside the view's own buffers, the radiance pyramid and the
 *  depth: the deferred lighting's view. */
export type ReflectionOver = { lightView: GPUBuffer }

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), the lit
 *  image its pyramid holds now and `over`, made once a pyramid, lit image and depth, and while
 *  they stay: the two HDR targets taking turns find a group each. */
export function reflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  over: ReflectionOver,
) {
  const image = reflection.radiance.image.view
  let byImage = reflection.groups.get(depth)
  if (!byImage) reflection.groups.set(depth, (byImage = new WeakMap()))
  const kept = byImage.get(image)
  if (kept && kept.over[0] === over.lightView) return kept.group
  const { device } = reflection
  const group = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: 0, resource: { buffer: reflection.uniform } },
      { binding: 1, resource: reflection.radiance.view },
      { binding: 2, resource: reflection.radiance.sampler },
      ...hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth),
      { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: over.lightView } },
      { binding: REFLECTION_IMAGE_BINDING, resource: image },
    ],
  })
  byImage.set(image, { group, over: [over.lightView] })
  return group
}

/** What a frame holds that the reflection reads (`reflectionOver`). */
export type ReflectionHost = {
  gpu: {
    reflection?: ScreenReflection
    deferred?: { uniform: GPUBuffer }
  }
  vis: { gpuHiz?: GpuHiz }
}

/** The reflection group's other resource: the lighting's view. Undefined while the lighting is not made. */
export function reflectionOver({ gpu }: ReflectionHost): ReflectionOver | undefined {
  const { deferred } = gpu
  if (!deferred) return undefined
  return { lightView: deferred.uniform }
}

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection
 *  over its depth pyramid, both made with the frame's targets and the visibility programs. */
export function bindForwardReflection(pass: GPURenderPassEncoder, rt: ReflectionHost) {
  const depth = rt.vis.gpuHiz?.depth(),
    over = reflectionOver(rt)
  if (rt.gpu.reflection && depth && over)
    pass.setBindGroup(REFLECTION_GROUP, reflectionGroup(rt.gpu.reflection, depth, over))
}

/**
 * Whether the view's reflections are what a still view shows: the radiance pyramid holds an image
 * of this view, and — when no temporal accumulation turns the projection from image to image, whose
 * own settling covers it — that image was drawn from where the one before it was, and its lit
 * image is the one before it's (`settle.verified`), so the image traced on it reflects the view as
 * it stands, never the one it moved from nor the light it changed. A held image is then final:
 * drawn again, it gives the same bits.
 */
/** The image the reflections last reflected shows a scene that is no more: content joined it. The
 *  next image traces nothing and builds the radiance from its own lit image, as a scene opened with
 *  that content draws its first, so the images that follow are the same bits as a fresh open's,
 *  whatever the scene was before — the series they converge to starts from the same image. */
export function forgetReflectedImage(reflection: ScreenReflection | undefined) {
  if (!reflection) return
  reflection.radiance.held.valid = false
  reflection.settle.busy()
}

export const reflectionsSettled = (
  reflection: ScreenReflection | undefined,
  accumulating: boolean,
) =>
  !reflection ||
  (reflection.radiance.held.valid &&
    (accumulating || (reflection.radiance.held.still && reflection.settle.verified)))
