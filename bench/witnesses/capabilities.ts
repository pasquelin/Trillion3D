/**
 * The capability sheet of the witnesses written with the host library: what they draw and what
 * they leave undone. The engine publishes its own sheets; only the witnesses and the browser
 * test pages that stand in for one read this.
 */
import type { BackendCapabilities } from '../../packages/sdk-core/src/index.ts';

export const baseCapabilities: BackendCapabilities = {
  renderer: 'Three.js WebGL2',
  materials: 'Converted glTF PBR, textures, alpha and double-sided flags preserved; no shadow map',
  hierarchy: false,
  gpuDriven: false,
  simplification: false,
  eviction: false,
  unsupported: [
    // Light-contract calls exist on the host and do not fail here: they are ignored.
    'contract scene lights with shadow atlas',
    'named node transforms',
    'general mesh LOD simplification',
    'GPU-driven selection/indirect draw',
    'occlusion culling',
    'bounded GPU eviction',
    'physical VRAM instrumentation',
  ],
};

/** What the exact witness leaves undone: the base list, less what its bounded eviction and its
 *  contract lights retire, plus the shadows those lights do not cast. */
const RETIRES = ['bounded GPU eviction', 'contract scene lights with shadow atlas'];
export const CONTRACT_LIGHTS_UNSUPPORTED = baseCapabilities.unsupported
  .filter((item) => !RETIRES.includes(item))
  .concat('contract scene light shadows');
