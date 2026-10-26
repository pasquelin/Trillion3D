import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * Makes the display texture the image last shown before a reader copies it or the canvas is given
 * it again. An image composed straight onto the canvas (`canvasOnly`) left it behind: it is
 * composed once more from the same lit image, finishing group and uniforms, into the display
 * texture alone — no scene pass runs, so no history, clock or frame number moves and the pixels
 * are those the canvas got.
 */
export function freshDisplay(rt: WebgpuPagesRuntime) {
  const { gpu, run } = rt
  const { canvasOnly: kept, device, deferred, displayView } = gpu
  if (!kept || !device || !deferred || !displayView || run.lost) return
  const encoder = device.createCommandEncoder({ label: 'Trillion3D display colour' })
  deferred.compose(
    encoder,
    displayView,
    kept.clear,
    undefined,
    kept.composed,
    kept.asIs,
    kept.source,
  )
  device.queue.submit([encoder.finish()])
  gpu.canvasOnly = undefined
}
