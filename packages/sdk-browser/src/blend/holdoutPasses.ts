import { heldColour } from '../gpu/core/heldAttachment.ts'
import { drawFullscreenTriangle } from '../gpu/shader/fullscreenTriangle.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { computeTextureEntry } from '../gpu/core/computeBindings.ts'
import {
  chainReady,
  fullscreenDescriptor,
  preparedPipeline,
  type PreparedPipeline,
} from '../lighting/deferred/fullscreen.ts'
import { HOLDOUT_APPLY_PASS, HOLDOUT_START_PASS } from '../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { ALPHA_ONLY } from '../materials/surface/materialBlending.ts'
import { HOLDOUT_FORMAT } from './holdout.ts'
import { HOLDOUT_APPLY_WGSL, HOLDOUT_START_WGSL } from './holdoutWgsl.ts'

/** The two passes' pipelines and the layout they read one texture through, made once for the device. */
const passes = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D alpha holdout',
    entries: [computeTextureEntry(0, 'float', '2d', GPUShaderStage.FRAGMENT)],
  })
  const applies = (module: GPUShaderModule) => ({
    apply: made(module, 'holdoutApply', HOLDOUT_APPLY_PASS, [
      { format: HDR_FORMAT, writeMask: ALPHA_ONLY },
    ]),
    applyCovered: made(module, 'holdoutApplyCovered', HOLDOUT_APPLY_PASS, [
      { format: HDR_FORMAT, writeMask: ALPHA_ONLY },
    ]),
  })
  const made = (
    module: GPUShaderModule,
    entry: string,
    label: string,
    targets: GPUColorTargetState[],
  ) => preparedPipeline(device, fullscreenDescriptor(device, module, layout, entry, targets, label))
  return {
    layout,
    start: made(
      device.createShaderModule({ label: HOLDOUT_START_PASS, code: HOLDOUT_START_WGSL }),
      'holdoutStart',
      HOLDOUT_START_PASS,
      [{ format: HOLDOUT_FORMAT }],
    ),
    ...applies(device.createShaderModule({ label: HOLDOUT_APPLY_PASS, code: HOLDOUT_APPLY_WGSL })),
  }
})

/** Asks the three passes' pipelines (`askBlendReach`, once the holdout is reached), off the frame. */
export function askHoldoutPasses(device: GPUDevice) {
  const { start, apply, applyCovered } = passes(device)
  for (const pipeline of [start, apply, applyCovered]) pipeline.ask()
}

/** Whether the holdout's passes are compiled: the start, the accumulation and the application are one
 *  chain (the visibility the layers lay replaces the image's alpha), so none runs before. */
export const holdoutPassesReady = (device: GPUDevice) => {
  const { start, apply, applyCovered } = passes(device)
  return chainReady(start, apply, applyCovered)
}

const copyTarget = heldColour({ loadOp: 'clear', storeOp: 'store' })
/** The full-screen passes' descriptor, held: its label, target and load are those of the pass. */
const COPY: GPURenderPassDescriptor = { colorAttachments: [copyTarget] }

/** One full-screen pass of `pipeline` over `target`, reading `source`. */
function drawOver(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  label: string,
  pipeline: PreparedPipeline<GPURenderPipeline>,
  source: GPUTextureView,
  target: GPUTextureView,
  loadOp: GPULoadOp,
  size: readonly number[],
) {
  const group = device.createBindGroup({
    layout: passes(device).layout,
    entries: [{ binding: 0, resource: source }],
  })
  copyTarget.view = target
  copyTarget.loadOp = loadOp
  COPY.label = label
  // Compiled: `holdoutPassesReady` ran before the holdout's first pass.
  drawFullscreenTriangle(encoder, COPY, pipeline.get()!, group, size[0], size[1])
}

/** Fills `holdout` with the alpha of `lit`, `size` pixels, as the background visibility, and a
 *  throughput of 1. */
export function copyHoldoutStart(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  lit: GPUTextureView,
  holdout: GPUTextureView,
  size: readonly number[],
) {
  drawOver(device, encoder, HOLDOUT_START_PASS, passes(device).start, lit, holdout, 'clear', size)
}

/** Lays the visibility `holdout` holds over the alpha of `lit`, `size` pixels — only where a layer
 *  left something, if `covered`. */
export function applyHoldout(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  lit: GPUTextureView,
  holdout: GPUTextureView,
  size: readonly number[],
  covered = false,
) {
  const { apply, applyCovered } = passes(device)
  drawOver(
    device,
    encoder,
    HOLDOUT_APPLY_PASS,
    covered ? applyCovered : apply,
    holdout,
    lit,
    'load',
    size,
  )
}
