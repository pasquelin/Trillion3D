/**
 * What the WebGPU core lends the impostor family (#1335, `../../impostor/lent.ts`): the shared
 * pieces, and the surfaces, depth, visibility targets, view, attachments, texture bytes, device
 * check and validation scope of the card passes.
 */
export * from '../../impostor/lent.ts';
export { SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts';
export { EMISSIVE_AO_SURFACE_FLAG } from '../../scene/surfaceModel.ts';
export { DEPTH_CLEAR, DEPTH_COMPARE_OR_EQUAL } from '../../camera/depthConvention.ts';
export { VIS_DEPTH, visTargets } from '../visibility/pipelines.ts';
export { viewProj } from '../pages/helpers.ts';
export { surfaceLoadAttachments } from '../pages/prepare/attachments.ts';
export { textureBytesOf } from '../../gpu/core/textureBytes.ts';
export { deviceMade, validationScope } from '../../gpu/core/errorScope.ts';
