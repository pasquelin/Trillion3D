import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { computeBufferEntry, computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { DISPLAY_FORMAT } from '../../../scene/targetFormats.ts'
import { OUTLINE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { KEEP } from '../../../blend/equations.ts'
import { OVER } from '../../../materials/surface/materialBlending.ts'
import { OUTLINE_FORMAT } from './outlineTarget.ts'
import { OUTLINE_WGSL } from './outlineWgsl.ts'
import { CANVAS_FORMAT } from '../../../gpu/core/canvasFormat.ts'

/** The line laid over what is there, premultiplied; the display keeps its alpha. */
const LINE_BLEND: GPUBlendState = { color: OVER, alpha: KEEP }

/** The outline's programs (`outlineWgsl.ts`) and their two group layouts: the selection's — the
 *  identifiers, the page table, the chosen placements and the uniform — and the scan's target. */
export async function createOutlinePrograms(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT
  const selection = device.createBindGroupLayout({
    label: `${OUTLINE_PASS} selection`,
    entries: [
      computeTextureEntry(0, 'uint', '2d', fragment),
      computeBufferEntry(1, 'read-only-storage', fragment),
      computeBufferEntry(2, 'read-only-storage', fragment),
      computeBufferEntry(3, 'uniform', fragment),
    ],
  })
  const scan = device.createBindGroupLayout({
    label: `${OUTLINE_PASS} scan`,
    entries: [computeTextureEntry(0, 'unfilterable-float', '2d', fragment)],
  })
  const module = await createCheckedShaderModule(device, OUTLINE_WGSL, OUTLINE_PASS)
  const display = { format: DISPLAY_FORMAT, blend: LINE_BLEND }
  const [across, over, overPresent] = await Promise.all([
    makeFullscreenPipeline(device, module, selection, 'across', [{ format: OUTLINE_FORMAT }]),
    makeFullscreenPipeline(device, module, [selection, scan], 'over', [display]),
    makeFullscreenPipeline(device, module, [selection, scan], 'overPresent', [
      display,
      { format: CANVAS_FORMAT, blend: LINE_BLEND },
    ]),
  ])
  return { selection, scan, across, over, overPresent }
}
