import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { DEPTH_CLEAR } from '../camera/depthConvention.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { chainReady } from '../lighting/deferred/fullscreen.ts'
import type { TranslucencyTargets } from './translucency.ts'
import { pointGroup, pointPass, pointProgram, writePoint } from './translucencyPoint.ts'

/**
 * THE DEPTH THE SMALLER LAYERS ARE TESTED AGAINST. Layers drawn into targets smaller than the image are tested against the scene's depth taken at
 * their size: the texel of the scene's depth that lies under each texel of the smaller target, the first of its square, no filter (the point
 * filter). `DOWNSAMPLE_DEPTH_WGSL` reads it by integer coordinates, the destination texel times the ratio of the sizes, cut to the source's last
 * texel; the target is cleared to the far depth, so what the pass does not cover (past the drawn size) holds the background.
 */
export const DOWNSAMPLE_DEPTH_WGSL = pointProgram(
  'texture_depth_2d',
  '@builtin(frag_depth) f32',
  'downsampleDepth',
  'vec2f(vec2i(pixel.xy))*span.xy',
  ' return textureLoad(source,at,0);',
)

/** The pass, made once for the device. */
const downsample = oncePerDevice((device: GPUDevice) =>
  pointPass(
    device,
    'Trillion3D translucency depth',
    device.createShaderModule({
      label: 'Trillion3D translucency depth',
      code: DOWNSAMPLE_DEPTH_WGSL,
    }),
    'downsampleDepth',
    'depth',
    [],
    { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
  ),
)

/** The pass's pipeline, which the targets of the smaller layers are asked to compile (`followTranslucency`). */
export const translucencyDepthPipelines = (device: GPUDevice) => [downsample(device).pipeline]

/** The attachment of the pass, held: it clears the target to the far depth and stores it. */
const attachment: GPURenderPassDepthStencilAttachment = {
  view: undefined as unknown as GPUTextureView,
  depthLoadOp: 'clear',
  depthClearValue: DEPTH_CLEAR,
  depthStoreOp: 'store',
}
const DESCRIPTOR: GPURenderPassDescriptor = {
  label: 'Trillion3D translucency depth',
  colorAttachments: [],
  depthStencilAttachment: attachment,
}

/**
 * Makes the depth of the translucency targets `set` from `scene`, the opaque depth of the `source` pixels drawn: one full-screen pass over the
 * `set.drawn` texels. Nothing while the pipeline compiles; returns whether the depth is made — the layers are not drawn without it.
 */
export function downsampleTranslucencyDepth(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  set: TranslucencyTargets,
  scene: GPUTextureView,
  source: readonly [number, number],
) {
  const made = downsample(device)
  if (!chainReady(made.pipeline)) return false
  const [width, height] = set.drawn
  writePoint(device, made, source[0] / width, source[1] / height, source[0] - 1, source[1] - 1)
  const group = pointGroup(device, made, scene, 'Trillion3D translucency depth')
  attachment.view = set.reduced!.depthView
  const pass = encoder.beginRenderPass(DESCRIPTOR)
  pass.setViewport(0, 0, width, height, 0, 1)
  pass.setPipeline(made.pipeline.get()!)
  pass.setBindGroup(0, group)
  pass.draw(3)
  pass.end()
  return true
}
