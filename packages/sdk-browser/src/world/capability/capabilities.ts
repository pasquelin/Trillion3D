import { EngineError } from '../../../../sdk-core/src/index.ts'
import { WEBGPU_REQUIRED_WGSL_FEATURES } from '../../engine/common.ts'

/** What this machine's WebGPU grants, read before any session opens. */
export type GpuCapabilities = {
  /** `'full'` with GPU timestamps, `'degraded'` without them, `'unavailable'` with no adapter. */
  tier: 'full' | 'degraded' | 'unavailable'
  /** The optional features the adapter offers. */
  extensions: string[]
  /** One sentence saying what was granted, or why nothing was. */
  reason: string
  /** The adapter a device is asked of; `null` when none was granted or a device was handed in. */
  adapter: GPUAdapter | null
}

/** The refusal of a machine that grants no WebGPU: the engine draws with nothing else. */
export const webgpuUnavailable = (reason: string) =>
  new EngineError(
    'WEBGPU_UNAVAILABLE',
    `Trillion3D draws with WebGPU only, and this browser grants none: ${reason}. ` +
      'Open the page in a browser with WebGPU enabled.',
  )

/** The capabilities of a machine that grants nothing, and why. */
const unavailable = (reason: string): GpuCapabilities => ({
  tier: 'unavailable',
  extensions: [],
  reason,
  adapter: null,
})

/** Why `gpu`'s shader language cannot compile the engine's programs: the required WGSL language
 *  features it lacks (`WEBGPU_REQUIRED_WGSL_FEATURES`), or `undefined` when it has them all. */
export function wgslRefusal(gpu: GPU): string | undefined {
  const offered = gpu.wgslLanguageFeatures
  const missing = WEBGPU_REQUIRED_WGSL_FEATURES.filter((name) => !offered?.has(name))
  return missing.length ? `its WGSL lacks ${missing.join(', ')}` : undefined
}

/** The WebGPU entry point of `environment`: the one handed in, else `navigator.gpu` where a
 *  navigator exists. */
export const gpuOf = (environment: { gpu?: GPU }) =>
  environment.gpu ?? (typeof navigator === 'undefined' ? undefined : navigator.gpu)

/** The tier a set of granted features reaches. */
const tierOf = (features: { has(name: string): boolean }) =>
  features.has('timestamp-query') ? ('full' as const) : ('degraded' as const)

/** Checks what this machine's WebGPU grants, and says why when it grants nothing. `gpu` stands
 *  for `navigator.gpu`. */
export async function detectCapabilities(
  environment: { gpu?: GPU } = {},
): Promise<GpuCapabilities> {
  const gpu = gpuOf(environment)
  if (!gpu) return unavailable('the browser exposes no navigator.gpu')
  const refusal = wgslRefusal(gpu)
  if (refusal) return unavailable(refusal)
  const adapter = await gpu.requestAdapter()
  if (!adapter) return unavailable('no WebGPU adapter')
  return {
    tier: tierOf(adapter.features),
    extensions: [...adapter.features],
    reason: 'WebGPU adapter available',
    adapter,
  }
}

/** The capabilities of a device the host handed in: no adapter is asked for. */
export const deviceCapabilities = (device: GPUDevice): GpuCapabilities => ({
  tier: tierOf(device.features),
  extensions: [...device.features],
  reason: 'WebGPU device handed in by the host',
  adapter: null,
})
