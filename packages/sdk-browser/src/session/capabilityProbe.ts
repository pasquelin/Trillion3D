import {
  detectCapabilities,
  deviceCapabilities,
  gpuOf,
  webgpuUnavailable,
  wgslRefusal,
  type GpuCapabilities,
} from '../api/capability/capabilities.ts'
import { grantedGpuFeatures } from '../gpu/core/gpuCaps.ts'
import { grantedDevice } from '../api/capability/worldReady.ts'
import { sayFatal, type ExplorerSession } from './session.ts'

/** What the machine offers, read before the scene. */
export type ExplorerProbe = Awaited<ReturnType<typeof probeExplorerCapabilities>>

/** The device the session draws on: the host's when it handed one in, else one asked of the
 *  machine's adapter. A machine that grants none, or whose WGSL lacks a language feature the
 *  programs need (`wgslRefusal`), is a fatal, said by name (`WEBGPU_UNAVAILABLE`)
 *  before anything is read for the scene: the engine draws with WebGPU only. */
export async function probeExplorerCapabilities(session: ExplorerSession) {
  const { options, scope, diagnose } = session
  const refuse = (reason: string): never => {
    const error = webgpuUnavailable(reason)
    sayFatal(session, 'WEBGPU_UNAVAILABLE', error.message, {
      phase: 'error',
      message: 'WebGPU unavailable',
      context: { kind: 'error', code: 'WEBGPU_UNAVAILABLE', reason, scope },
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
    const offered = await detectCapabilities({ gpu: options.gpu })
    const granted = await grantedDevice(offered)
    if (typeof granted === 'string') return refuse(granted)
    gpuDevice = granted
    capabilities = deviceCapabilities(gpuDevice, offered.adapter)
  }
  diagnose('capability', 'WebGPU device granted', {
    kind: 'capability',
    tier: capabilities.tier,
    features: grantedGpuFeatures(gpuDevice),
    scope,
  })
  return { capabilities, gpuDevice }
}
