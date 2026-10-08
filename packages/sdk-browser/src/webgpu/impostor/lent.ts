/**
 * What the core lends the impostor family (#1335, #1336): the shared sprite basis, card bit, pixel
 * scale, held-level read, eviction and diagnostics, and the surfaces, depth, visibility targets,
 * view, attachments, texture bytes, device check, validation scope and pipeline build of the card
 * passes. `loadImpostorCode` hands this lend to the family when it arrives
 * (`../../impostor/borrowed.ts`), and the family reads its types alone: imported by the family,
 * these core modules would be shared by its chunk and split the CDN core into more chunks, which
 * gzip worse (`check-bundle-size.ts`).
 */
export { markCard, SPRITE_WGSL } from '../../visibility/shader/spriteWgsl.ts'
export { focalPixels } from '../../../../math/src/projection/camera.ts'
export { grownCapacity } from '../../placement/rows.ts'
export { createHeldLevels, readHeldLevel } from '../../texture/heldLevels.ts'
export { evictOldest } from '../../streaming/evictOldest.ts'
export { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts'
export { SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts'
export { EMISSIVE_AO_SURFACE_FLAG } from '../../scene/surfaceModel.ts'
export { DEPTH_CLEAR, DEPTH_COMPARE_OR_EQUAL } from '../../camera/depthConvention.ts'
export { VIS_DEPTH, VIS_TARGETS, scoped } from '../visibility/pipelines.ts'
export { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
export { viewProj } from '../pages/helpers.ts'
export { surfaceLoadAttachments } from '../pages/prepare/attachments.ts'
export { textureBytesOf } from '../../gpu/core/textureBytes.ts'
export { deviceMade } from '../../gpu/core/errorScope.ts'
export { createDenseKeySet } from '../cut/denseKeys.ts'
export { createMovedWorlds, takeMovedWorlds } from '../pages/render/movedWorlds.ts'
export { writeRanges } from '../../gpu/dag/split.ts'
