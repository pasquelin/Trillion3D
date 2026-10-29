import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { arrayView, layerView } from '../../../gpu/core/textureViews.ts'
import { CAPSULE_BLENDS } from '../../capsuleShadows/frame.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../deferred/fullscreen.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { SelfShadowTargetFormat } from '../firstPerson/selfShadowLocal.ts'
import type { SelfShadowRect } from '../firstPerson/selfShadowWindow.ts'
import { runRayTracedShadow } from './rayTracedKit.ts'
import { RAY_TRACED_MERGE_ENTRY as MERGE_ENTRY, rayTracedMergeProgram } from './rayTracedWgsl.ts'

/** One local light to give a ray traced shadow: its rank in the light buffer, the rays a pixel casts to it, and the mask (a view of the format) it is taken into. */
export interface LocalRayTraced {
  rank: number
  samples: number
  target: GPUTextureView
  format: SelfShadowTargetFormat
}

/** The merge's bind group layout and shader module. */
const mergeOf = oncePerDevice((device: GPUDevice) => ({
  layout: device.createBindGroupLayout({
    label: 'Trillion3D ray traced shadow merge',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  }),
  module: device.createShaderModule({
    label: 'Trillion3D ray traced shadow merge',
    code: rayTracedMergeProgram(),
  }),
}))

/** The merge pipeline into a mask of `format`: the minimum of what the mask holds and the shadow's square root (`CAPSULE_BLENDS.attenuation`), the masks' keeping. */
const mergePipelineOf = oncePerDeviceKey((device: GPUDevice, format: SelfShadowTargetFormat) => {
  const { layout, module } = mergeOf(device)
  return preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      module,
      layout,
      MERGE_ENTRY,
      [{ format, blend: CAPSULE_BLENDS.attenuation }],
      `Trillion3D ray traced shadow merge ${format}`,
    ),
  ).ask()
})

/** The local lights' shadows at the drawn size, a layer a light: the storage the kernel writes and a view of each layer the merge reads. */
type LocalOut = {
  size: string
  capacity: number
  texture: GPUTexture
  storage: GPUTextureView
  layers: GPUTextureView[]
}
const outs = new WeakMap<GPUDevice, LocalOut>()

/** The local lights' texture let go (retired). */
export function releaseRayTracedLocal(device: GPUDevice) {
  const old = outs.get(device)
  if (!old) return
  outs.delete(device)
  retire(device, { destroy: () => old.texture.destroy() })
}

function localOutFor(device: GPUDevice, size: readonly [number, number], count: number) {
  const key = size.join('x')
  const held = outs.get(device)
  if (held?.size === key && held.capacity >= count) return held
  count = Math.max(count, held?.size === key ? held.capacity : 0)
  releaseRayTracedLocal(device)
  const texture = device.createTexture({
    label: 'Trillion3D ray traced shadow local lights',
    size: [size[0], size[1], count],
    format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const made = {
    size: key,
    capacity: count,
    texture,
    storage: arrayView(texture),
    layers: Array.from({ length: count }, (_, layer) => layerView(texture, layer)),
  }
  outs.set(device, made)
  return made
}

const attachment: GPURenderPassColorAttachment = {
  view: undefined as never,
  loadOp: 'load',
  storeOp: 'store',
}
const MERGE_PASS: GPURenderPassDescriptor = {
  label: 'vsm.rayTracedShadow.merge',
  colorAttachments: [attachment],
}

/**
 * THE RAY TRACED SHADOW OF LOCAL LIGHTS: for each of `jobs` the kernel (`runRayTracedShadow`) casts its rays over `scissor` (first column and row, one past the
 * last; the drawn image by default) into a layer of the lights' texture, and the layer is taken into the light's mask by the minimum over the same rectangle,
 * as the square root the masks keep. Every other shadow of the light stands.
 */
export function encodeLocalRayTraced(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  rays: SceneRays,
  jobs: readonly LocalRayTraced[],
  views: readonly GPUTextureView[],
  scissor?: SelfShadowRect,
) {
  const { device } = rt.gpu
  if (!device || !jobs.length) return
  const [x0, y0, x1, y1] = scissor ?? [0, 0, rt.gpu.targetSize[0], rt.gpu.targetSize[1]]
  const out = localOutFor(device, rt.gpu.allocatedSize, jobs.length)
  const { layout } = mergeOf(device)
  jobs.forEach((job, k) => {
    const traced = runRayTracedShadow(
      rt,
      encoder,
      settings,
      rays,
      { ...job, output: out.storage, layerBase: k, rect: [x0, y0, x1, y1] },
      views,
    )
    const pipeline = traced && mergePipelineOf(device, job.format).get()
    if (!pipeline) return
    attachment.view = job.target
    const pass = encoder.beginRenderPass(MERGE_PASS)
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: out.layers[k]! }],
      }),
    )
    pass.setScissorRect(x0, y0, x1 - x0, y1 - y0)
    pass.draw(3)
    pass.end()
  })
}
