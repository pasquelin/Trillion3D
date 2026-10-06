// WebGPU transmission's code, a family on demand (`../../host/families.ts`): the water pass
// every transmissive surface draws through — glass as water —, its surface stage's WGSL and its
// pipelines, one module so that the CDN bundle makes one chunk of it. The blend stage of a scene
// that transmits awaits it at prepare (`../blend/pipelines.ts`); its frame side stays in the core
// (`pass.ts`, `rank.ts`).
export { createWaterPass, waterWithoutFeedback } from './waterPass.ts'
export { WATER_SURFACE_WGSL } from './surfaceWgsl.ts'
