import { detectCapabilities, webgpuUnavailable, type GpuCapabilities } from './capabilities.ts'
import { requestExplorerDevice } from '../session/gpuDevice.ts'

/** The device the adapter `capabilities` read grants, or why there is none: no adapter, or one
 *  that refused its device. The one path a world and a session ask a device by. */
export async function grantedDevice(capabilities: GpuCapabilities): Promise<GPUDevice | string> {
  if (!capabilities.adapter) return capabilities.reason
  try {
    return await requestExplorerDevice(capabilities.adapter)
  } catch (error) {
    return `its adapter refused a device (${String(error)})`
  }
}

/**
 * The WebGPU device a world draws with, asked before any scene is loaded and held for the world's
 * life: every session it opens draws on it. A machine that grants no adapter, or an adapter that
 * refuses its device, is refused by name (`WEBGPU_UNAVAILABLE`).
 */
export async function probeWorldDevice(): Promise<GPUDevice> {
  const granted = await grantedDevice(await detectCapabilities())
  if (typeof granted === 'string') throw webgpuUnavailable(granted)
  return granted
}
