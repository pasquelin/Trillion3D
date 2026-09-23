import { detectCapabilities } from '../../measurement/capabilities.ts';
import { sessionOf } from '../core/worldSession.ts';

/** The `capability` family: what the machine grants, before an image is promised. */
export const capability = {
  /** Which engine paths this machine grants (`detectCapabilities`), and why. */
  async detect() {
    const canvas = typeof document === 'undefined' ? undefined : document.createElement('canvas');
    const [webgpu, webgl] = await Promise.all([
      detectCapabilities('webgpu', canvas as HTMLCanvasElement),
      detectCapabilities('webgl', canvas as HTMLCanvasElement),
    ]);
    return {
      webgpu: !!webgpu.renderer,
      webgl2: !!webgl.renderer,
      tier: webgpu.tier,
      features: webgpu.extensions,
      reasons: { webgpu: webgpu.reason, webgl2: webgl.reason },
    };
  },
  /**
   * What the path drawing `world` does with lights (`lightingCapabilities`).
   * @param world - The world to ask.
   */
  lighting: (world: object) => sessionOf(world).lightingCapabilities(),
};

export { probeWorldRenderer, type WorldRenderer } from './worldReady.ts';
