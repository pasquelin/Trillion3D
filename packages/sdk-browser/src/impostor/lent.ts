/**
 * What the core lends the impostor family (#1335, #1336): the engine's pieces both card draws use —
 * the WebGL2 cluster program's fragments, program, uniform and sampler set-up, float textures and
 * byte count; the WebGPU surfaces, depth, visibility targets, view and attachments; the shared
 * sprite basis, card bit, pixel scale, held-level read, eviction and diagnostics. `loadImpostorCode`
 * hands this module to the family when it arrives (`borrowed.ts`), and the family reads its types
 * alone: imported by the family, these core modules would be shared by its chunk and split the CDN
 * core into more chunks, which gzip worse (`check-bundle-size.ts`).
 */
import { SUBSURFACE_UNIT } from '../webgl/cluster/materialMaps.ts';

export { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT, variant } from '../webgl/cluster/shaders.ts';
export { createWebglProgram } from '../webgl/core/program.ts';
export { setClusterSamplers, uniformLocations } from '../webgl/cluster/uniforms.ts';
export {
  FLOAT_TEXELS,
  LIGHT_ROW_TEXELS,
  WebglLightTexture,
} from '../webgl/cluster/lightTexture.ts';
export { sentBytes } from '../webgl/cluster/sentBytes.ts';
export { allocated } from '../webgl/core/allocation.ts';
export { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
export { SURFACE_FORMATS } from '../scene/surfaceBuffer.ts';
export { EMISSIVE_AO_SURFACE_FLAG } from '../scene/surfaceModel.ts';
export { DEPTH_CLEAR, DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts';
export { VIS_DEPTH, visTargets } from '../webgpu/visibility/pipelines.ts';
export { viewProj } from '../webgpu/pages/helpers.ts';
export { surfaceLoadAttachments } from '../webgpu/pages/prepare/attachments.ts';
export { textureBytesOf } from '../gpu/core/textureBytes.ts';
export { deviceMade } from '../gpu/core/errorScope.ts';
export { markCard, spriteAt } from '../visibility/shader/spriteWgsl.ts';
export { pixelScaleOf } from '../streaming/priority.ts';
export { grownCapacity } from '../placement/rows.ts';
export { createHeldLevels, readHeldLevel } from '../texture/heldLevels.ts';
export { evictOldest } from '../streaming/evictOldest.ts';
export { sendEngineDiagnostic } from '../diagnostic/engineDiagnostic.ts';

/** The units of the card records and of the three atlas maps: past every unit the cluster program
 *  binds (`setClusterSamplers`, the subsurface map last), so a card draw leaves its bindings as
 *  they were. */
export const CARD_RECORD_UNIT = SUBSURFACE_UNIT + 1;
export const ATLAS_UNITS = [CARD_RECORD_UNIT + 1, CARD_RECORD_UNIT + 2, CARD_RECORD_UNIT + 3];
