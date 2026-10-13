import { oncePerDevice } from './oncePerDevice.ts'
import { sharedGpuDevice } from './sessionHandle.ts'

/** A resource the retire list frees: a buffer, a texture, a pool of them. */
type Retired = { destroy(): void }

/** The resources retired on each device since its last frame submit; every session's handle on
 *  a device shares its device's list. */
const retiredOf = oncePerDevice((): Retired[] => [])

/**
 * THE FRAME-END RETIRE LIST: a resource replaced while the image is encoded — a table grown, a
 * target remade — may still be named by commands of this image not yet submitted, so it is retired
 * here rather than destroyed, and destroyed right after the frame's `queue.submit`
 * (`destroyRetired`, `../../webgpu/pages/render/encoder.ts`). Destroyed after the submit that names
 * it, it lives while that work runs: WebGPU frees a resource once the work submitted before its
 * `destroy` is done. One list per device and one walk a frame, no promise per resource.
 */
export const retire = (device: GPUDevice, resource: Retired) =>
  void retiredOf(sharedGpuDevice(device)).push(resource)

/** After the frame's `queue.submit`: everything retired on `device` since the last one goes. */
export function destroyRetired(device: GPUDevice) {
  const retired = retiredOf(sharedGpuDevice(device))
  for (const resource of retired) resource.destroy()
  retired.length = 0
}
