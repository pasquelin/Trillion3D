import { detectCapabilities } from './capabilities.ts'
import { sessionOf } from '../core/worldSession.ts'

/** The `capability` family: what the machine grants, before an image is promised. */
export const capability = {
  /** Whether this machine grants WebGPU (`detectCapabilities`), its tier, and why. */
  async detect() {
    const webgpu = await detectCapabilities()
    return {
      webgpu: webgpu.tier !== 'unavailable',
      tier: webgpu.tier,
      features: webgpu.extensions,
      reason: webgpu.reason,
    }
  },
  /**
   * What the engine drawing `world` does with lights (`lightingCapabilities`).
   * @param world - The world to ask.
   */
  lighting: (world: object) => sessionOf(world).lightingCapabilities(),
}

export { probeWorldDevice } from './worldReady.ts'
