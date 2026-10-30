import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { chainReady } from '../lighting/deferred/fullscreen.ts'
import { RESPONSIVE_FORMAT, RESPONSIVE_TARGET } from './responsive.ts'
import { FEEDBACK_FORMAT } from '../scene/targetFormats.ts'
import { TRANSPARENTS_PASS } from '../diagnostic/stage/passLabels.ts'
import type { ReducedLayers, TranslucencyTargets } from './translucency.ts'
import {
  pointGroup,
  pointPass,
  pointProgram,
  writePoint,
  type PointPass,
} from './translucencyPoint.ts'

/**
 * THE MARKS OF THE SMALLER LAYERS. The responsiveness pass (`drawResponsive`) and the passes that post the virtual-texture requests
 * (`layersFeedback`) of layers drawn into targets smaller than the image mark a target of their size; `upsampleResponsive` and `layFeedback`
 * lay the marks over the image's own target: each pixel reads the mark under it, the texel of the smaller target at its place (the pixel times
 * the ratio of the sizes, cut to the last texel drawn), and writes it where it marks anything — the responsiveness keeping the largest of the
 * marks as the layers keep them, the requests the layer's last, as the pixels of the image post theirs.
 */
const layProgram = (type: string, entry: string, write: string) =>
  pointProgram(
    `texture_2d<${type}>`,
    `@location(0) ${type}`,
    entry,
    'pixel.xy*span.xy',
    ` let mark=textureLoad(source,at,0).r;
 if(${write}){discard;}
 return mark;`,
  )

export const UPSAMPLE_RESPONSIVE_WGSL = layProgram('f32', 'upsampleResponsive', 'mark<=0.0')

/** The same over the virtual-texture feedback target: a request is a non-zero word. */
export const LAY_FEEDBACK_WGSL = layProgram('u32', 'layFeedback', 'mark==0u')

const laying = oncePerDevice((device: GPUDevice) => ({
  responsive: pointPass(
    device,
    'Trillion3D translucency responsive',
    device.createShaderModule({
      label: 'Trillion3D translucency responsive',
      code: UPSAMPLE_RESPONSIVE_WGSL,
    }),
    'upsampleResponsive',
    'float',
    [RESPONSIVE_TARGET],
  ),
  feedback: pointPass(
    device,
    'Trillion3D translucency feedback',
    device.createShaderModule({
      label: 'Trillion3D translucency feedback',
      code: LAY_FEEDBACK_WGSL,
    }),
    'layFeedback',
    'uint',
    [{ format: FEEDBACK_FORMAT }],
  ),
}))

/** The passes' pipelines, which the targets of the smaller layers are asked to compile. */
export function upsampleResponsivePipelines(device: GPUDevice) {
  const { responsive, feedback } = laying(device)
  return [responsive.pipeline, feedback.pipeline]
}

/** The marks of the smaller layers' responsiveness, a target of the size of the translucency targets, made the first time it is asked and
 *  cleared by each responsiveness pass. */
export function reducedResponsiveOf(
  device: GPUDevice,
  reduced: ReducedLayers,
  extent: readonly [number, number],
) {
  if (!reduced.responsive) {
    const texture = device.createTexture({
      label: 'Trillion3D translucency responsiveness',
      size: { width: extent[0], height: extent[1] },
      format: RESPONSIVE_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    reduced.responsive = { texture, view: texture.createView() }
  }
  return reduced.responsive.view
}

/** The responsiveness target the marks are laid over, loaded. */
const responsiveOver: GPURenderPassColorAttachment = {
  view: undefined as unknown as GPUTextureView,
  loadOp: 'load',
  storeOp: 'store',
}
const overTarget: GPURenderPassColorAttachment[] = [responsiveOver]
const DESCRIPTOR: GPURenderPassDescriptor = {
  label: TRANSPARENTS_PASS,
  colorAttachments: overTarget,
}

/** Lays the marks of `set` in `marks` over `target`, the attachment of the image's target of `size` pixels, with `made`'s pass. Nothing while the pipeline
 *  compiles (the marks are then lost for this image). Returns the draws. */
function lay(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  made: PointPass,
  set: TranslucencyTargets,
  marks: GPUTextureView | undefined,
  target: GPURenderPassColorAttachment,
  size: readonly [number, number],
) {
  if (!marks || !chainReady(made.pipeline)) return 0
  writePoint(
    device,
    made,
    set.drawn[0] / size[0],
    set.drawn[1] / size[1],
    set.drawn[0] - 1,
    set.drawn[1] - 1,
  )
  const group = pointGroup(device, made, marks, 'Trillion3D translucency marks')
  overTarget[0] = target
  const pass = encoder.beginRenderPass(DESCRIPTOR)
  pass.setViewport(0, 0, size[0], size[1], 0, 1)
  pass.setPipeline(made.pipeline.get()!)
  pass.setBindGroup(0, group)
  pass.draw(3)
  pass.end()
  return 1
}

/** Lays the responsiveness `set` marked over `target`, the image's responsiveness target of `size` pixels. Returns the draws. */
export function upsampleResponsive(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  set: TranslucencyTargets,
  target: GPUTextureView,
  size: readonly [number, number],
) {
  responsiveOver.view = target
  return lay(
    device,
    encoder,
    laying(device).responsive,
    set,
    set.reduced?.responsive?.view,
    responsiveOver,
    size,
  )
}

/** Lays the virtual-texture requests `set` posted (`layersFeedback`) over the image's feedback target of `size` pixels, `target` being its
 *  attachment (`feedbackAttachment`: cleared by the first pass of the image that writes it, loaded after), where the requests of the image's
 *  own passes stand. Returns the draws. */
export const layFeedback = (
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  set: TranslucencyTargets,
  target: GPURenderPassColorAttachment,
  size: readonly [number, number],
) => lay(device, encoder, laying(device).feedback, set, set.reduced?.feedbackView, target, size)
