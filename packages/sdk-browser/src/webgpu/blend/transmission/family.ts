// WebGPU transmission's code, a family on demand (`../../../host/families.ts`): the transmissive
// stages of the blend module — every transmissive surface lit and composed as a thin
// translucent layer, and its distortion — and their pipelines, one module so that the CDN bundle makes
// one chunk of it. The blend programs of a scene that transmits await it at prepare
// (`../pipelines.ts`); the frame side stays in the core (`../draw.ts`,
// `../distortion.ts`).
export { transmitWgsl } from './transmitWgsl.ts'
export { createTransmitPipelines } from './pipelines.ts'
