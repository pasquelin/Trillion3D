// The diagnostic code, a family on demand (`../session/host/families.ts`, #1353): the WebGPU feedback A/B
// measurements and the frame inspection, one module so that the CDN bundle makes one chunk of it.
export {
  captureFeedbackAb,
  feedbackAbResidency,
  prepareFeedbackAb,
  setFeedbackTargetAb,
} from './feedback/feedbackAb.ts'
export { feedbackAbSpatial } from './feedback/feedbackSpatial.ts'
export { inspectFrame } from './inspection/read.ts'
