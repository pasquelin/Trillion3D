import { postSamplers } from '../gpu/core/postSamplers.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { chainReady, preparedPipeline } from './deferred/fullscreen.ts'
import { DISPLAY_FORMAT } from '../scene/targetFormats.ts'
import { BLIT_WGSL } from './overlayWgsl.ts'

const OVERLAY_BLIT_LABEL = 'Trillion3D debug overlay blit'

/** The pipeline that lays a debug texture over the display image, once a device: its colour taken as premultiplied by its alpha. */
export const overlayBlit = oncePerDevice((device: GPUDevice) => {
  const module = device.createShaderModule({ label: OVERLAY_BLIT_LABEL, code: BLIT_WGSL })
  return preparedPipeline(device, {
    label: OVERLAY_BLIT_LABEL,
    layout: 'auto',
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: {
      module,
      entryPoint: 'blit',
      targets: [
        {
          format: DISPLAY_FORMAT,
          blend: {
            color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  })
})

/** Whether the overlay pipeline is ready: false while it compiles, the caller drawing nothing yet. */
export const overlayReady = (device: GPUDevice) => chainReady(overlayBlit(device))

/** A rectangle of display pixels: its corner and its size. */
export interface OverlayRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The bindings of `overlay`, a texture of the size of the rectangle it is laid over, made again only when the texture is. */
export const overlayGroup = (device: GPUDevice, overlay: GPUTextureView) =>
  device.createBindGroup({
    layout: overlayBlit(device).get()!.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: overlay },
      { binding: 1, resource: postSamplers(device).clamped },
    ],
  })

/** The part of `rect` the display of `size` holds, none where it holds nothing: the rectangle itself where it fits whole. A picture drawn for the
 *  rectangle is drawn for this part alone, so a texel falls on a pixel. */
export function clipOverlay(
  rect: OverlayRect,
  size: readonly [number, number],
): OverlayRect | undefined {
  const width = Math.min(rect.width, size[0] - rect.x)
  const height = Math.min(rect.height, size[1] - rect.y)
  if (!(rect.x >= 0 && rect.y >= 0 && width > 0 && height > 0)) return undefined
  return width === rect.width && height === rect.height ? rect : { ...rect, width, height }
}

/** Lays the texture `group` binds (`overlayGroup`) over the pixels of `rect` that `target`, a display of `size`, holds: the texture is the size of
 *  that part (`clipOverlay`), so the viewport is the part itself and never leaves the attachment. */
export function layOverlay(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  label: string,
  target: GPUTextureView,
  group: GPUBindGroup,
  rect: OverlayRect,
  size: readonly [number, number],
) {
  const at = clipOverlay(rect, size)
  if (!at) return
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
  })
  pass.setPipeline(overlayBlit(device).get()!)
  pass.setViewport(at.x, at.y, at.width, at.height, 0, 1)
  pass.setBindGroup(0, group)
  pass.draw(3)
  pass.end()
}
