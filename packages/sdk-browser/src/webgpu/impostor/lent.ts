/**
 * What the core lends the impostor family (#1335, #1336, #1527): the shared sprite basis, card bit,
 * pixel scale and diagnostics, the tile pool's reads, group and feedback the cards read their maps
 * through, and the surfaces, depth, visibility targets, view, attachments, validation scope and
 * pipeline build of the card passes. `loadImpostorCode` hands this lend to the family when it arrives
 * (`../../impostor/borrowed.ts`), and the family reads its types alone: imported by the family,
 * these core modules would be shared by its chunk and split the CDN core into more chunks, which
 * gzip worse (`check-bundle-size.ts`).
 */
export { VIS_CARD_BASE } from '../../visibility/visWords.ts'
export { markCard, SPRITE_WGSL } from '../../visibility/shader/spriteWgsl.ts'
export { focalPixels } from '../../../../math/src/projection/camera.ts'
export { grownLength } from '../../../../math/src/sequence/resized.ts'
export { cardTileEntries, cardTileLayoutEntries, cardTileWgsl } from '../tile/cardReads.ts'
export { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts'
export { FEEDBACK_FORMAT, SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts'
export { EMISSIVE_AO_SURFACE_FLAG } from '../../scene/surfaceModel.ts'
export { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
export { VIS_DEPTH, VIS_TARGETS, scoped } from '../visibility/pipelines.ts'
export { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
export { viewProj } from '../pages/helpers.ts'
export { cardColorAttachments } from '../pages/prepare/attachments.ts'
export { createDenseKeySet } from '../cut/denseKeys.ts'
export { createChangedRuns } from '../residency/ranges.ts'
export { writeRanges } from '../../gpu/dag/runWrites.ts'
export { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
export { retire } from '../../gpu/core/frameRetire.ts'
