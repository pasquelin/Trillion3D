/**
 * The engine modules the exact witness is assembled from, named once: the witness lives beside the
 * bench, and these are the engine's own parts it drives with the host library.
 */
export { createExactPagesRender, createExactPagesRenderState } from './render.ts';
export { createWebglFrameGate } from '../../../packages/sdk-browser/src/webgl/core/frameGate.ts';
export { createExactPagesCpu } from './cpu.ts';
export { createExactPagesRequests, createExactPagesRequestData } from './requests.ts';
export { createExactPagesResidency } from './residency.ts';
export { DEFAULT_CLEAR_COLOR } from '../../../packages/sdk-browser/src/backend/common.ts';
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
