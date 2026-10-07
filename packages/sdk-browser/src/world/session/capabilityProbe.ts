import {
  detectCapabilities,
  deviceCapabilities,
  gpuOf,
  webgpuUnavailable,
  wgslRefusal,
  type GpuCapabilities,
} from '../capability/capabilities.ts'
import { grantedGpuFeatures } from './gpuDevice.ts'
import { grantedDevice } from '../capability/worldReady.ts'
import type { ExplorerSession } from './session.ts'

/** What the machine offers, read before the scene. */
export type ExplorerProbe = Awaited<ReturnType<typeof probeExplorerCapabilities>>

/** The device the session draws on: the host's when it handed one in, else one asked of the
 *  machine's adapter. A machine that grants none, or whose WGSL lacks a language feature the
 *  programs need (`wgslRefusal`), is a fatal, said by name (`WEBGPU_UNAVAILABLE`)
 *  before anything is read for the scene: the engine draws with WebGPU only. */
export async function probeExplorerCapabilities(session: ExplorerSession) {
  const { options, scope, emit, diagnose } = session
  const refuse = (reason: string): never => {
    const error = webgpuUnavailable(reason)
    emit({
      eventVersion: 1,
      type: 'fatal',
      audience: 'blocking',
      recovered: false,
      code: 'WEBGPU_UNAVAILABLE',
      detail: error.message,
    })
    diagnose('error', 'WebGPU unavailable', {
      kind: 'error',
      code: 'WEBGPU_UNAVAILABLE',
      reason,
      scope,
    })
    throw error
  }
  let capabilities: GpuCapabilities
  let gpuDevice = options.gpuDevice
  if (gpuDevice) {
    // A handed-in device compiles the same programs: the browser's WGSL must offer their features.
    const gpu = gpuOf(options)
    const refusal = gpu && wgslRefusal(gpu)
    if (refusal) return refuse(refusal)
    capabilities = deviceCapabilities(gpuDevice)
  } else {
    capabilities = await detectCapabilities({ gpu: options.gpu })
    const granted = await grantedDevice(capabilities)
    if (typeof granted === 'string') return refuse(granted)
    gpuDevice = granted
  }
  diagnose('capability', 'WebGPU device granted', {
    kind: 'capability',
    tier: capabilities.tier,
    features: grantedGpuFeatures(gpuDevice),
    scope,
  })
  return { capabilities, gpuDevice }
}
