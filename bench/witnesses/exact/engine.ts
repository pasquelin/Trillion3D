/**
 * The engine modules the exact witness is assembled from, named once: the witness lives beside the
 * bench, and these are the engine's own parts it drives with the host library — beside the one list
 * of what the witness leaves undone, which is the witness's and not the engine's.
 */
export { createExactPagesRender, createExactPagesRenderState } from './render.ts';
export { createWebglFrameGate } from '../../../packages/sdk-browser/src/webgl/core/frameGate.ts';
export { createExactPagesCpu } from './cpu.ts';
export { createExactPagesRequests, createExactPagesRequestData } from './requests.ts';
export { createExactPagesResidency } from './residency.ts';
import { baseCapabilities } from '../../../packages/sdk-browser/src/backend/common.ts';
export {
  DEFAULT_CLEAR_COLOR,
  baseCapabilities,
} from '../../../packages/sdk-browser/src/backend/common.ts';

/** What the witness leaves undone: the base list, less what its bounded eviction and its contract
 *  lights retire, plus the shadows those lights do not cast. */
const RETIRES = ['bounded GPU eviction', 'contract scene lights with shadow atlas'];
export const CONTRACT_LIGHTS_UNSUPPORTED = baseCapabilities.unsupported
  .filter((item) => !RETIRES.includes(item))
  .concat('contract scene light shadows');
export {
  contractLightingApi,
  graphBackground,
  installLighting,
} from '../../../packages/sdk-browser/src/lighting/contractLightingApi.ts';
export { GraphScene } from '../../../packages/sdk-browser/src/host/graph/scene.ts';
export {
  collectClusterPages,
  type PageRec,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';
export { createBlendCopy } from '../../../packages/sdk-browser/src/cluster/blendCopyMesh.ts';
export type { DiagnosticMode } from '../../../packages/sdk-core/src/index.ts';
export type { BackendFactory } from '../../../packages/sdk-browser/src/backend/types.ts';
export type { CameraMotion } from '../../../packages/sdk-browser/src/camera/world.ts';
