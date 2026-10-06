/**
 * What the core lends the impostor family on either renderer: the shared sprite
 * basis, card bit, pixel scale, held-level read, eviction and diagnostics. Each renderer lends
 * these with its own pieces (`../webgl/impostor/lent.ts`, `../webgpu/impostor/lent.ts`), so the
 * WebGL2 path never loads WebGPU code; `loadImpostorCode` hands the renderer's lend to the family
 * when it arrives (`borrowed.ts`), and the family reads its types alone: imported by the family,
 * these core modules would be shared by its chunk and split the CDN core into more chunks, which
 * gzip worse (`check-bundle-size.ts`).
 */
export { markCard, spriteAt } from '../visibility/shader/spriteWgsl.ts'
export { pixelScaleOf } from '../streaming/priority.ts'
export { grownCapacity } from '../placement/rows.ts'
export { createHeldLevels, readHeldLevel } from '../texture/heldLevels.ts'
export { evictOldest } from '../streaming/evictOldest.ts'
export { sendEngineDiagnostic } from '../diagnostic/engineDiagnostic.ts'
