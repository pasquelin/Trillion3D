// The impostor draw's code, a family on demand (`../host/families.ts`, #1335, #1336), one module
// so that the CDN bundle makes one chunk of it: the image's card plan, the card pipelines and atlas
// feed, and their encodes. It loads through `loadImpostorCode` (`code.ts`), awaited where a cache
// with baked impostors prepares; refused, every root keeps its clusters.
export { planWebgpuImpostors } from '../webgpu/impostor/frame.ts'
export {
  drawImpostorVisibility,
  encodeImpostorCards,
  encodeImpostorVisibilityPass,
} from '../webgpu/impostor/encode.ts'
export { prepareImpostorPipelines } from '../webgpu/impostor/pipelines.ts'
export { lend } from './borrowed.ts'
