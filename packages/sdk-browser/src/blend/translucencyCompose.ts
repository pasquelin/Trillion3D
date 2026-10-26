import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { heldColour } from '../gpu/core/heldAttachment.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { computeTextureEntry, computeUniformEntry } from '../gpu/core/computeBindings.ts'
import {
  chainReady,
  fullscreenDescriptor,
  preparedPipeline,
} from '../lighting/deferred/fullscreen.ts'
import { TRANSLUCENCY_COMPOSE_PASS } from '../diagnostic/stage/passLabels.ts'
import {
  COMPOSE_DUAL_WGSL,
  COMPOSE_WGSL,
  LATE_BINDINGS,
  LATE_WGSL,
} from './translucencyComposeWgsl.ts'
import { layersLayout } from './translucencyLayers.ts'
import { settle, type TranslucencyTargets } from './translucency.ts'
import {
  BLEND_EQUATIONS,
  COLOUR_ONLY,
  OVER,
  SCALED_BY_ALPHA,
} from '../materials/surface/materialBlending.ts'
import { dualSource } from './stagePipelines.ts'

/**
 * THE COMPOSITION OF THE TRANSLUCENCY (`translucency.ts`) where no pass of the image composes it in its
 * own program: onto the views of the image in place (`composeTranslucency`, `composeLateOnto`), or, for
 * the layers drawn after the motion blur, into a new image (`composeLateImage`) — the image the
 * temporal pass resolved is the history of the next, and is never written to.
 */

/** The scene's colour multiplied by the modulation and its alpha by what the draw gives it (the
 *  background the modulation leaves visible, times the transmittance), then the light laid over it
 *  with the transmittance's complement as its coverage (`OVER`), the alpha left alone. */
const SCALE_BLEND: GPUBlendState = {
  color: BLEND_EQUATIONS.multiply.color,
  alpha: SCALED_BY_ALPHA,
}
const ADD_BLEND: GPUBlendState = { color: OVER, alpha: OVER }
/** The dual-source draw's state, one target: the light, plus the scene times the second source —
 *  the modulation times the transmittance —, and the alpha the scene's times the second source's. */
const COMPOSE_DUAL_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'src1', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'src1-alpha', operation: 'add' },
}

/** The composition's pipelines made once for the device, a draw for each of one or two targets (the
 *  image the effects read, and the lit image the reflections keep): `[scale, add]` of one, then
 *  of two, then — on a device granted `dual-source-blending` — the one draw of one target
 *  (`composeDual`). */
const composePipelines = oncePerDevice((device: GPUDevice) => {
  const module = device.createShaderModule({
    label: 'Trillion3D translucency compose',
    code: COMPOSE_WGSL,
  })
  const pairs = [1, 2].flatMap((count) =>
    (
      [
        ['scale', SCALE_BLEND],
        ['add', ADD_BLEND],
      ] as const
    ).map(([entryPoint, blend]) =>
      preparedPipeline(
        device,
        fullscreenDescriptor(
          device,
          module,
          layersLayout(device),
          entryPoint,
          Array.from({ length: count }, () => ({
            format: HDR_FORMAT,
            blend,
            ...(entryPoint === 'add' && { writeMask: COLOUR_ONLY }),
          })),
          'Trillion3D translucency compose',
        ),
      ),
    ),
  )
  if (!dualSource(device)) return pairs
  return [
    ...pairs,
    preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        device.createShaderModule({
          label: 'Trillion3D translucency compose, dual-source',
          code: COMPOSE_DUAL_WGSL,
        }),
        layersLayout(device),
        'composeDual',
        [{ format: HDR_FORMAT, blend: COMPOSE_DUAL_BLEND }],
        'Trillion3D translucency compose',
      ),
    ),
  ]
})

/** Asks the compositions' pipelines to compile, off the frame. */
export const askComposePipelines = (device: GPUDevice) =>
  composePipelines(device).forEach((pipeline) => pipeline.ask())

/** A colour attachment the composition loads and stores, its view set each image. */
const loadedColour = (): GPURenderPassColorAttachment => ({
  view: undefined as unknown as GPUTextureView,
  loadOp: 'load',
  storeOp: 'store',
})

/** The composition's colour attachments, one array for one target and one for two, their views set
 *  each image: no image allocates one. */
const composeColour = [[loadedColour()], [loadedColour(), loadedColour()]]
/** The compose pass's descriptor, held: its attachments are those of the views composed onto. */
const COMPOSE: GPURenderPassDescriptor = { label: TRANSLUCENCY_COMPOSE_PASS, colorAttachments: [] }
/** The late composition's, over a cleared image of its own. */
const lateTarget = heldColour({ loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] })
const LATE: GPURenderPassDescriptor = {
  label: TRANSLUCENCY_COMPOSE_PASS,
  colorAttachments: [lateTarget],
}

/** Composes the layers `set` drew onto the first `count` views of `onto`, in place:
 *  `colour·modulation·transmittance + light`, and the image's alpha times both — in one dual-source
 *  draw on one target where the device grants it, else in two, the scene's colour multiplied by the
 *  modulation, then the light laid over it. Nothing
 *  where the image drew none (or composed them already); the layers are `shown` for the temporal pass
 *  even where `count` is 0. Returns the draws. */
function composeSet(
  { gpu, run }: Pick<WebgpuPagesRuntime, 'gpu' | 'run'>,
  set: TranslucencyTargets | undefined,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  onto: readonly GPUTextureView[],
  count: number,
) {
  if (set?.phase !== 'drawn' && set?.phase !== 'fused') return 0
  const pipelines = composePipelines(device),
    first = count === 1 && pipelines[4] ? 4 : (count - 1) * 2,
    draws = first === 4 ? 1 : 2
  // The two draws of a pair are one composition (the scale, then the add): none is encoded, and the
  // layers stay unsettled, while one compiles.
  if (count && !chainReady(...pipelines.slice(first, first + draws))) return 0
  settle(set)
  if (!count) return 0
  const colour = composeColour[count - 1]
  for (let k = 0; k < count; k++) colour[k].view = onto[k]
  COMPOSE.colorAttachments = colour
  const pass = encoder.beginRenderPass(COMPOSE)
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  pass.setBindGroup(0, set.modulated ? set.group : set.groupBare)
  for (let k = first; k < first + draws; k++) {
    pass.setPipeline(pipelines[k].get()!)
    pass.draw(3)
  }
  pass.end()
  run.gpuDrawCalls += draws
  return draws
}

/** Composes the translucency of the image onto the first `count` views of `onto` — the lit image the
 *  effects go on from, and the one the reflections keep —, in place (`composeSet`). */
export const composeTranslucency = (
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'run'>,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  onto: readonly GPUTextureView[],
  count = onto.length,
) => composeSet(rt, rt.gpu.translucency, device, encoder, onto, count)

/** Composes the layers drawn after the motion blur onto `onto`, in place: where the image shows no
 *  effect, or composes nothing after the lit image. */
export const composeLateOnto = (
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'run'>,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  onto: readonly GPUTextureView[],
) => composeSet(rt, rt.gpu.translucency?.late, device, encoder, onto, onto.length)

/** The layout of the late composition's second group: the image, and where the layers lie in it. */
const lateLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D translucency late',
    entries: [
      computeTextureEntry(LATE_BINDINGS.scene, 'float', '2d', GPUShaderStage.FRAGMENT),
      computeUniformEntry(LATE_BINDINGS.view, {}, GPUShaderStage.FRAGMENT),
    ],
  }),
)

/** The late composition's pipeline, its view's uniform and the groups binding it to each image it
 *  has read (the image of the temporal pass and the motion blur take turns). */
const latePipeline = oncePerDevice((device: GPUDevice) => {
  const module = device.createShaderModule({
    label: 'Trillion3D translucency late',
    code: LATE_WGSL,
  })
  return {
    pipeline: preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        [layersLayout(device), lateLayout(device)],
        'composeLate',
        [{ format: HDR_FORMAT }],
        'Trillion3D translucency late',
      ),
    ),
    uniform: device.createBuffer({
      label: 'Trillion3D translucency late view',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    groups: new WeakMap<GPUTextureView, GPUBindGroup>(),
    words: new Float32Array(8),
  }
})

/** Asks the late composition's pipeline to compile, off the frame. */
export const askLatePipeline = (device: GPUDevice) => latePipeline(device).pipeline.ask()

/**
 * Composes the layers drawn after the motion blur over `scene`, the image of `size` pixels the
 * chain leaves, into a new image of the late set (`TranslucencyTargets.lateImage`), which it
 * returns: the layers were drawn at the render size, and are read through the bilinear sampler at
 * the pixel's place where the image is the display's. `undefined` where the image drew none.
 */
export function composeLateImage(
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'run'>,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  scene: GPUTextureView,
  size: readonly number[],
) {
  const { gpu, run } = rt,
    late = gpu.translucency?.late,
    image = gpu.translucency?.lateImage
  if (late?.phase !== 'drawn' || !image) return undefined
  const made = latePipeline(device)
  // Not compiled: the layers stay unsettled and the image is left as it is, the frames waiting for it.
  if (!chainReady(made.pipeline)) return undefined
  settle(late)
  const pipeline = made.pipeline.get()!
  const [width, height] = size,
    [drawnWidth, drawnHeight] = gpu.targetSize,
    extent = [late.color.width, late.color.height]
  const next = [
    width,
    height,
    1 / width,
    1 / height,
    drawnWidth / extent[0],
    drawnHeight / extent[1],
    (drawnWidth - 0.5) / extent[0],
    (drawnHeight - 0.5) / extent[1],
  ]
  let changed = false
  for (const [i, word] of next.entries())
    if (made.words[i] !== Math.fround(word)) {
      made.words[i] = word
      changed = true
    }
  if (changed) device.queue.writeBuffer(made.uniform, 0, made.words)
  let group = made.groups.get(scene)
  if (!group) {
    group = device.createBindGroup({
      label: 'Trillion3D translucency late',
      layout: lateLayout(device),
      entries: [
        { binding: LATE_BINDINGS.scene, resource: scene },
        { binding: LATE_BINDINGS.view, resource: { buffer: made.uniform } },
      ],
    })
    made.groups.set(scene, group)
  }
  lateTarget.view = image.view
  const pass = encoder.beginRenderPass(LATE)
  pass.setViewport(0, 0, width, height, 0, 1)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, late.modulated ? late.group : late.groupBare)
  pass.setBindGroup(1, group)
  pass.draw(3)
  pass.end()
  run.gpuDrawCalls++
  return image.view
}
