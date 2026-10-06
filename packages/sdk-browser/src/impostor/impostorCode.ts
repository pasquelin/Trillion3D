// The impostor draw's code, a family on demand (`../host/families.ts`, #1335, #1336), one module
// so that the CDN bundle makes one chunk of it, as the particles' holds both renderers': on WebGPU
// the image's card plan, the card pipelines and atlas feed, and their encodes; on WebGL2 the tier
// that plans, feeds and draws the same cards. Both load it through the one `loadImpostorCode`
// (`code.ts`), awaited where a cache with baked impostors prepares; refused, every root keeps its
// clusters.
export { planWebgpuImpostors } from '../webgpu/impostor/frame.ts'
export {
  drawImpostorVisibility,
  encodeImpostorCards,
  encodeImpostorVisibilityPass,
} from '../webgpu/impostor/encode.ts'
export { prepareImpostorPipelines } from '../webgpu/impostor/pipelines.ts'
export { createWebglImpostors } from '../webgl/impostor/frame.ts'
export { lend } from './borrowed.ts'
