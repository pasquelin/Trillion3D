// The diagnostic code, a family on demand (`../host/families.ts`, #1353): the WebGPU feedback A/B
// measurements, one module so that the CDN bundle makes one chunk of it.
export {
  captureFeedbackAb,
  feedbackAbResidency,
  prepareFeedbackAb,
  setFeedbackTargetAb,
} from '../webgpu/pages/diagnostic/feedbackAb.ts'
export { feedbackAbSpatial } from '../webgpu/pages/diagnostic/feedbackSpatial.ts'
