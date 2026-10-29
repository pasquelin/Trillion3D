import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { arrayView, layerView } from '../../../gpu/core/textureViews.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../deferred/fullscreen.ts'
import { CAPSULE_BLENDS } from '../../capsuleShadows/frame.ts'
import { firstPersonBoundsOf } from '../../reflections/firstPersonBounds.ts'
import type { VsmProjectionLight } from '../vsm/projection/projectionPass.ts'
import { lightAffectsSphere } from './affects.ts'
import {
  runSelfShadow,
  selfShadowRecords as records,
  type SelfShadowRect,
} from './selfShadowKit.ts'
import {
  SELF_SHADOW_MAX_LIGHTS,
  SELF_SHADOW_MERGE_BINDINGS as M,
  SELF_SHADOW_MERGE_ENTRY,
  selfShadowMergeProgram,
} from './selfShadowWgsl.ts'

/** The masks a local light's self shadow is taken into: the one-pass projection's capsule layers (`r8unorm`) and the per-light path's masks (`rgba8unorm`). */
export type SelfShadowTargetFormat = 'r8unorm' | 'rgba8unorm'

/** One local light to give the first-person objects a self shadow: the light, its rank in the light buffer, and the mask (a view of the format) it is taken into. */
export interface LocalSelfShadow {
  light: VsmProjectionLight
  rank: number
  target: GPUTextureView
  format: SelfShadowTargetFormat
}

/** The merge's bind group layout and shader module. */
const mergeOf = oncePerDevice((device: GPUDevice) => ({
  layout: device.createBindGroupLayout({
    label: 'Trillion3D first person self shadow merge',
    entries: [
      {
        binding: M.shadow,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
      { binding: M.flags, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
    ],
  }),
  module: device.createShaderModule({
    label: 'Trillion3D first person self shadow merge',
    code: selfShadowMergeProgram(),
  }),
}))

/** The merge pipeline into a mask of `format`: the minimum of what the mask holds and the shadow (`CAPSULE_BLENDS.attenuation`). */
const mergePipelineOf = oncePerDeviceKey((device: GPUDevice, format: SelfShadowTargetFormat) => {
  const { layout, module } = mergeOf(device)
  return preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      module,
      layout,
      SELF_SHADOW_MERGE_ENTRY,
      [{ format, blend: CAPSULE_BLENDS.attenuation }],
      `Trillion3D first person self shadow merge ${format}`,
    ),
  ).ask()
})

/** The shadows of the local lights at the drawn size, a layer a light: the storage the kernels write and a view of each layer the merge reads. */
type LocalOut = {
  size: string
  capacity: number
  texture: GPUTexture
  storage: GPUTextureView
  layers: GPUTextureView[]
}
const outs = new WeakMap<GPUDevice, LocalOut>()

/** The local lights' texture let go (retired). */
export function releaseLocalSelfShadow(device: GPUDevice) {
  const old = outs.get(device)
  if (!old) return
  outs.delete(device)
  retire(device, { destroy: () => old.texture.destroy() })
}

function localOutFor(device: GPUDevice, size: readonly [number, number], count: number) {
  const key = size.join('x')
  const held = outs.get(device)
  // Made for the most lights asked at this size, so that runs of different counts do not remake it by turns.
  if (held?.size === key && held.capacity >= count) return held
  count = Math.max(count, held?.size === key ? held.capacity : 0)
  releaseLocalSelfShadow(device)
  const texture = device.createTexture({
    label: 'Trillion3D first person self shadow local lights',
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

const bounds = new Float64Array(4)
const attachment: GPURenderPassColorAttachment = {
  view: undefined as never,
  loadOp: 'load',
  storeOp: 'store',
}
const MERGE_PASS: GPURenderPassDescriptor = {
  label: 'vsm.firstPersonSelfShadow.merge',
  colorAttachments: [attachment],
}

/** Whether any of the local lights `lights` from index `first` reaches the first-person objects' bounds: the lights that take a self shadow (`lightAffectsSphere`). */
export function localLightsReachFirstPerson(
  rt: WebgpuPagesRuntime,
  lights: readonly VsmProjectionLight[],
  first: number,
) {
  if (firstPersonBoundsOf(rt, bounds)[3]! <= 0) return false
  for (let k = first; k < lights.length; k++)
    if (lightAffectsSphere(lights[k]!, bounds, bounds[3]!)) return true
  return false
}

/**
 * THE FIRST-PERSON SELF SHADOW OF THE LOCAL LIGHTS: for each of `jobs` whose light reaches the first-person objects' bounds (`lightAffectsSphere`; a
 * sun's is traced beside the suns', `encodeFirstPersonSelfShadow`), the kernels (`runSelfShadow`) trace the first-person pixels toward the light, over
 * `scissor` (first column and row, one past the last; the drawn image by default), and its layer is taken into the light's mask by the minimum over the
 * same rectangle, as the square root the masks keep. The lights go in runs of `SELF_SHADOW_MAX_LIGHTS`, none left out. `views` are the surfaces' views (the
 * normals at 1, the flags at 3). Nothing for a light that does not reach them.
 */
export function encodeLocalSelfShadows(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  jobs: readonly LocalSelfShadow[],
  views: readonly GPUTextureView[],
  scissor?: SelfShadowRect,
) {
  const { device } = rt.gpu
  if (!device || firstPersonBoundsOf(rt, bounds)[3]! <= 0) return
  const reached = jobs.filter((job) => lightAffectsSphere(job.light, bounds, bounds[3]!))
  const [x0, y0, x1, y1] = scissor ?? [0, 0, rt.gpu.targetSize[0], rt.gpu.targetSize[1]]
  const { layout } = mergeOf(device)
  for (let first = 0; first < reached.length; first += SELF_SHADOW_MAX_LIGHTS) {
    const run = reached.slice(first, first + SELF_SHADOW_MAX_LIGHTS)
    run.forEach((job, k) => records.set([job.rank, 0, 0, 1], 4 * k))
    const out = localOutFor(device, rt.gpu.allocatedSize, run.length)
    const traced = runSelfShadow(
      rt,
      encoder,
      settings,
      { lights: records, count: run.length, output: out.storage, rect: [x0, y0, x1, y1] },
      views,
    )
    if (!traced) return
    run.forEach((job, k) => {
      const pipeline = mergePipelineOf(device, job.format).get()
      if (!pipeline) return
      attachment.view = job.target
      const pass = encoder.beginRenderPass(MERGE_PASS)
      pass.setPipeline(pipeline)
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout,
          entries: [
            { binding: M.shadow, resource: out.layers[k]! },
            { binding: M.flags, resource: views[3]! },
          ],
        }),
      )
      pass.setScissorRect(x0, y0, x1 - x0, y1 - y0)
      pass.draw(3)
      pass.end()
    })
  }
}
