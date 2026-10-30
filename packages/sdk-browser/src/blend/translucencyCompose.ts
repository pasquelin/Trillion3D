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
  LATE_UPSAMPLE_WGSL,
  LATE_WGSL,
  UPSAMPLE_BINDINGS,
  UPSAMPLE_DUAL_WGSL,
  UPSAMPLE_WGSL,
} from './translucencyComposeWgsl.ts'
import { nearestDepthUpsample } from './translucencyScale.ts'
import { pointGroup } from './translucencyPoint.ts'
import { wordsOf } from '../gpu/core/wordViews.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { readSeparateTranslucencySetting } from '../../../sdk-core/src/contracts/separateTranslucencyOptions.ts'
import { layersLayout } from './translucencyLayers.ts'
import {
  layersApart,
  settle,
  type TranslucencyTargets,
  type UpsampleState,
} from './translucency.ts'
import {
  BLEND_EQUATIONS,
  COLOUR_ONLY,
  OVER,
  SCALED_BY_ALPHA,
} from '../materials/surface/materialBlending.ts'
import { dualSource } from './stagePipelines.ts'
import { putDepthTerms } from '../post/taa/view.ts'
import { TAA_VIEW } from '../post/taa/bindingsWgsl.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'

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
const composePrograms = (
  device: GPUDevice,
  module: GPUShaderModule,
  dualModule: () => GPUShaderModule,
  bind: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
) => {
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
          bind,
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
        dualModule(),
        bind,
        'composeDual',
        [{ format: HDR_FORMAT, blend: COMPOSE_DUAL_BLEND }],
        'Trillion3D translucency compose',
      ),
    ),
  ]
}

const composePipelines = oncePerDevice((device: GPUDevice) =>
  composePrograms(
    device,
    device.createShaderModule({ label: 'Trillion3D translucency compose', code: COMPOSE_WGSL }),
    () =>
      device.createShaderModule({
        label: 'Trillion3D translucency compose, dual-source',
        code: COMPOSE_DUAL_WGSL,
      }),
    layersLayout(device),
  ),
)

/** The group of the smaller layers' composition: where they lie, their depth and the scene's (`UPSAMPLE_BINDINGS`); the depth of field's
 *  recombine reads it too. */
export const upsampleLayout = oncePerDevice((device: GPUDevice) => {
  const seen = GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE
  return device.createBindGroupLayout({
    label: 'Trillion3D translucency upsample',
    entries: [
      computeUniformEntry(UPSAMPLE_BINDINGS.view, {}, seen),
      computeTextureEntry(UPSAMPLE_BINDINGS.lowDepth, 'depth', '2d', seen),
      computeTextureEntry(UPSAMPLE_BINDINGS.fullDepth, 'depth', '2d', seen),
    ],
  })
})

/** The same draws for layers drawn into targets smaller than the image (`translucencyScale.ts`). */
const upsamplePipelines = oncePerDevice((device: GPUDevice) =>
  composePrograms(
    device,
    device.createShaderModule({ label: 'Trillion3D translucency upsample', code: UPSAMPLE_WGSL }),
    () =>
      device.createShaderModule({
        label: 'Trillion3D translucency upsample, dual-source',
        code: UPSAMPLE_DUAL_WGSL,
      }),
    [layersLayout(device), upsampleLayout(device)],
  ),
)

/** The pipelines of the composition of the smaller layers, and those of the late composition (`late`). */
export const upsamplePipelinesOf = (device: GPUDevice, late: boolean) => [
  ...upsamplePipelines(device),
  ...(late ? [latePipeline(device).upsample] : []),
]

/** Asks the compositions' pipelines to compile, off the frame; where the targets are smaller (`scaled`) those of the reduced layers too,
 *  an image drawing them at the image's size composing with the others. */
export function askComposePipelines(device: GPUDevice, scaled = false) {
  composePipelines(device).forEach((pipeline) => pipeline.ask())
  if (scaled) upsamplePipelines(device).forEach((pipeline) => pipeline.ask())
}

/** The farthest distance the nearest depth neighbour compares, in world units (the reference's 2,000,000 cm at `VSM_CM_PER_UNIT` a unit):
 *  past it the sky pixels would be taken for point samples by the relative test. */
const MAX_OPERATION_DISTANCE = 20000
/** The words of the upsample uniform (`Upsample`, `translucencyComposeWgsl.ts`): four vectors, the last two the depth terms. */
const UPSAMPLE_WORDS = 16
const UPSAMPLE_TERMS = { depth: 8, radius: 12 }
/** The block `putDepthTerms` writes the projection's terms in before copying the two vectors, held. */
const depthTerms = new Float32Array(TAA_VIEW.words)

/** What the smaller layers' place is written from: the runtime's settings and its target size and depth, which the depth of field's recombine
 *  gets from the frame it is handed (`ResolveFrame.reduced`). */
export type UpsampleHost = Pick<WebgpuPagesRuntime, 'gpu' | 'context'>

/** The upsample group of the composition of the smaller layers `set`: its words written when they change, so a second call in an image
 *  (the water, the late layers, the depth of field) reads what the set and the camera are now. The state is the set's own. `cam` is the
 *  camera of the image the layers lie over: its projection turns the depths into distances. */
export function upsampleGroup(
  device: GPUDevice,
  host: UpsampleHost,
  set: TranslucencyTargets,
  cam: Pick<EngineCamera, 'projection' | 'perspective'>,
) {
  const reduced = set.reduced!
  let state = reduced.upsample
  if (!state) {
    state = {
      uniform: device.createBuffer({
        label: 'Trillion3D translucency upsample',
        size: UPSAMPLE_WORDS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      floats: new Float32Array(UPSAMPLE_WORDS),
    } satisfies UpsampleState
    reduced.upsample = state
  }
  const [width, height] = set.extent,
    { floats } = state,
    { drawn } = set,
    [renderWidth, renderHeight] = host.gpu.targetSize,
    ratio = drawn[0] / renderWidth
  floats[0] = ratio / width
  floats[1] = drawn[1] / renderHeight / height
  floats[2] = (drawn[0] - 0.5) / width
  floats[3] = (drawn[1] - 0.5) / height
  floats[4] = 1 / width
  floats[5] = 1 / height
  floats[6] = nearestDepthUpsample(
    readSeparateTranslucencySetting(host, 'translucencyUpsampleMode'),
    ratio,
  )
    ? 1
    : 0
  // The farthest distance compared, and the projection's depth terms that turn a depth into a distance.
  floats[7] = MAX_OPERATION_DISTANCE
  putDepthTerms(
    floats,
    UPSAMPLE_TERMS,
    depthTerms,
    cam.projection,
    cam.perspective !== 0,
    renderWidth,
  )
  writeChanged(device, state.uniform, wordsOf(floats), 0, UPSAMPLE_WORDS)
  const full = host.gpu.depthView!
  if (state.low !== reduced.depthView || state.full !== full) {
    state.low = reduced.depthView
    state.full = full
    state.group = device.createBindGroup({
      label: 'Trillion3D translucency upsample',
      layout: upsampleLayout(device),
      entries: [
        { binding: UPSAMPLE_BINDINGS.view, resource: { buffer: state.uniform } },
        { binding: UPSAMPLE_BINDINGS.lowDepth, resource: reduced.depthView },
        { binding: UPSAMPLE_BINDINGS.fullDepth, resource: full },
      ],
    })
  }
  return state.group!
}

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
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'run' | 'context'>,
  set: TranslucencyTargets | undefined,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  onto: readonly GPUTextureView[],
  count: number,
) {
  if (set?.phase !== 'drawn' && set?.phase !== 'fused') return 0
  const { gpu, run } = rt
  const apart = layersApart(set),
    pipelines = (apart ? upsamplePipelines : composePipelines)(device),
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
  if (apart) pass.setBindGroup(1, upsampleGroup(device, rt, set, run.gate.cam))
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
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'run' | 'context'>,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  onto: readonly GPUTextureView[],
  count = onto.length,
) => composeSet(rt, rt.gpu.translucency, device, encoder, onto, count)

/** Composes the layers drawn after the motion blur onto `onto`, in place: where the image shows no
 *  effect, or composes nothing after the lit image. */
export const composeLateOnto = (
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'run' | 'context'>,
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

/** The late composition's pipelines — for layers the render size and for layers drawn smaller (`LATE_UPSAMPLE_WGSL`) —, its view's uniform and
 *  the groups binding it to each image it has read (the image of the temporal pass and the motion blur take turns). */
const latePipeline = oncePerDevice((device: GPUDevice) => {
  const pipelineOf = (module: GPUShaderModule, bind: GPUBindGroupLayout[], label: string) =>
    preparedPipeline(
      device,
      fullscreenDescriptor(device, module, bind, 'composeLate', [{ format: HDR_FORMAT }], label),
    )
  return {
    pipeline: pipelineOf(
      device.createShaderModule({ label: 'Trillion3D translucency late', code: LATE_WGSL }),
      [layersLayout(device), lateLayout(device)],
      'Trillion3D translucency late',
    ),
    upsample: pipelineOf(
      device.createShaderModule({
        label: 'Trillion3D translucency late upsample',
        code: LATE_UPSAMPLE_WGSL,
      }),
      [layersLayout(device), lateLayout(device), upsampleLayout(device)],
      'Trillion3D translucency late upsample',
    ),
    uniform: device.createBuffer({
      label: 'Trillion3D translucency late view',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    groups: new WeakMap<GPUTextureView, GPUBindGroup>(),
    floats: new Float32Array(8),
  }
})

/** Asks the late composition's pipelines to compile, off the frame; the reduced layers' too where the targets are smaller. */
export const askLatePipeline = (device: GPUDevice, scaled = false) => {
  const made = latePipeline(device)
  made.pipeline.ask()
  if (scaled) made.upsample.ask()
}

/**
 * Composes the layers drawn after the motion blur over `scene`, the image of `size` pixels the
 * chain leaves, into a new image of the late set (`TranslucencyTargets.lateImage`), which it
 * returns: the layers were drawn at the render size, and are read through the bilinear sampler at
 * the pixel's place where the image is the display's; layers drawn smaller are scaled up as the other
 * compositions do (`upsampleGroup`), from the render pixel under the image's, `cam` being the image's camera.
 * `undefined` where the image drew none.
 */
export function composeLateImage(
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'run' | 'context'>,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  scene: GPUTextureView,
  size: readonly number[],
  cam: EngineCamera,
) {
  const { gpu, run } = rt,
    late = gpu.translucency?.late,
    image = gpu.translucency?.lateImage
  if (late?.phase !== 'drawn' || !image) return undefined
  const made = latePipeline(device),
    apart = layersApart(late),
    pipelineAsked = apart ? made.upsample : made.pipeline
  // Not compiled: the layers stay unsettled and the image is left as it is, the frames waiting for it.
  if (!chainReady(pipelineAsked)) return undefined
  settle(late)
  const pipeline = pipelineAsked.get()!
  const [width, height] = size,
    [drawnWidth, drawnHeight] = apart ? late.drawn : gpu.targetSize,
    extent = [late.color.width, late.color.height]
  const { floats } = made
  floats[0] = width
  floats[1] = height
  floats[2] = 1 / width
  floats[3] = 1 / height
  // Scaled, the render size over the image's; else the layers' texels over the render size's and the last texel centre drawn.
  floats[4] = apart ? gpu.targetSize[0] / width : drawnWidth / extent[0]
  floats[5] = apart ? gpu.targetSize[1] / height : drawnHeight / extent[1]
  floats[6] = (drawnWidth - 0.5) / extent[0]
  floats[7] = (drawnHeight - 0.5) / extent[1]
  writeChanged(device, made.uniform, wordsOf(floats), 0, 8)
  const group = pointGroup(
    device,
    { layout: lateLayout(device), uniform: made.uniform, groups: made.groups },
    scene,
    'Trillion3D translucency late',
  )
  lateTarget.view = image.view
  const pass = encoder.beginRenderPass(LATE)
  pass.setViewport(0, 0, width, height, 0, 1)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, late.modulated ? late.group : late.groupBare)
  pass.setBindGroup(1, group)
  if (apart) pass.setBindGroup(2, upsampleGroup(device, rt, late, cam))
  pass.draw(3)
  pass.end()
  run.gpuDrawCalls++
  return image.view
}
